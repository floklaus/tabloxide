//! Converts the values of a parsed statement into BSON.

use mongodb::bson::{
    self, Binary, Bson, DateTime, Document, Regex, Timestamp, oid::ObjectId, spec::BinarySubtype,
};
use std::str::FromStr;
use tabloxide_core::mongo::Value;

/// A value that has no BSON form.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValueError(pub String);

type Converted<T> = Result<T, ValueError>;

fn error<T>(message: impl Into<String>) -> Converted<T> {
    Err(ValueError(message.into()))
}

/// Integers that fit into 32 bits become `Int32`, as in the MongoDB shell. Larger
/// integers become `Int64`. Each other number becomes `Double`.
fn number(text: &str) -> Converted<Bson> {
    let is_integer = text
        .trim_start_matches('-')
        .chars()
        .all(|c| c.is_ascii_digit());
    if is_integer {
        if let Ok(value) = text.parse::<i32>() {
            return Ok(Bson::Int32(value));
        }
        if let Ok(value) = text.parse::<i64>() {
            return Ok(Bson::Int64(value));
        }
    }
    match text {
        "Infinity" => Ok(Bson::Double(f64::INFINITY)),
        "-Infinity" => Ok(Bson::Double(f64::NEG_INFINITY)),
        "NaN" => Ok(Bson::Double(f64::NAN)),
        _ => text
            .parse::<f64>()
            .map(Bson::Double)
            .map_err(|_| ValueError(format!("`{text}` is not a number."))),
    }
}

fn text_arg<'a>(name: &str, args: &'a [Value]) -> Converted<&'a str> {
    match args {
        [Value::String(text)] => Ok(text),
        _ => error(format!("`{name}` needs one string.")),
    }
}

fn integer_arg(name: &str, args: &[Value]) -> Converted<i64> {
    match args {
        [Value::Number(text) | Value::String(text)] => text
            .parse::<i64>()
            .or_else(|_| text.parse::<f64>().map(|value| value as i64))
            .map_err(|_| ValueError(format!("`{name}` needs an integer."))),
        _ => error(format!("`{name}` needs one integer.")),
    }
}

/// Reads a date in the form of RFC 3339. A date without a time is midnight UTC.
fn parse_date(text: &str) -> Converted<DateTime> {
    let full = if text.len() == 10 {
        format!("{text}T00:00:00Z")
    } else {
        text.to_owned()
    };
    DateTime::parse_rfc3339_str(&full).map_err(|_| {
        ValueError(format!(
            "`{text}` is not a date. Use the form 2024-01-31T12:00:00Z."
        ))
    })
}

fn date(args: &[Value]) -> Converted<Bson> {
    match args {
        [] => Ok(Bson::DateTime(DateTime::now())),
        [Value::String(text)] => parse_date(text).map(Bson::DateTime),
        [Value::Number(_)] => Ok(Bson::DateTime(DateTime::from_millis(integer_arg(
            "Date", args,
        )?))),
        _ => error("`Date` needs a string or a number of milliseconds."),
    }
}

fn object_id(args: &[Value]) -> Converted<Bson> {
    if args.is_empty() {
        return Ok(Bson::ObjectId(ObjectId::new()));
    }
    let text = text_arg("ObjectId", args)?;
    ObjectId::parse_str(text).map(Bson::ObjectId).map_err(|_| {
        ValueError(format!(
            "`{text}` is not an ObjectId. An ObjectId has 24 hexadecimal characters."
        ))
    })
}

fn uuid(args: &[Value]) -> Converted<Bson> {
    let text = text_arg("UUID", args)?;
    let uuid =
        bson::Uuid::parse_str(text).map_err(|_| ValueError(format!("`{text}` is not a UUID.")))?;
    Ok(Bson::Binary(Binary {
        subtype: BinarySubtype::Uuid,
        bytes: uuid.bytes().to_vec(),
    }))
}

fn constructor(name: &str, args: &[Value]) -> Converted<Bson> {
    match name {
        "ObjectId" => object_id(args),
        "ISODate" | "Date" => date(args),
        "NumberInt" | "Int32" => {
            let value = integer_arg(name, args)?;
            i32::try_from(value)
                .map(Bson::Int32)
                .map_err(|_| ValueError(format!("{value} is too large for `NumberInt`.")))
        }
        "NumberLong" | "Long" => integer_arg(name, args).map(Bson::Int64),
        "NumberDecimal" | "Decimal128" => {
            let text = match args {
                [Value::String(text) | Value::Number(text)] => text,
                _ => return error(format!("`{name}` needs one string.")),
            };
            bson::Decimal128::from_str(text)
                .map(Bson::Decimal128)
                .map_err(|_| ValueError(format!("`{text}` is not a decimal number.")))
        }
        "Double" => match args {
            [Value::Number(text) | Value::String(text)] => text
                .parse()
                .map(Bson::Double)
                .map_err(|_| ValueError(format!("`{text}` is not a number."))),
            _ => error("`Double` needs one number."),
        },
        "UUID" => uuid(args),
        "Timestamp" => match args {
            [time, increment] => Ok(Bson::Timestamp(Timestamp {
                time: u32::try_from(integer_arg(name, std::slice::from_ref(time))?).unwrap_or(0),
                increment: u32::try_from(integer_arg(name, std::slice::from_ref(increment))?)
                    .unwrap_or(0),
            })),
            _ => error("`Timestamp` needs a time and an increment."),
        },
        "MinKey" => Ok(Bson::MinKey),
        "MaxKey" => Ok(Bson::MaxKey),
        _ => error(format!(
            "`{name}` is not a known constructor. Use ObjectId, ISODate, Date, NumberInt, NumberLong, NumberDecimal, UUID, Timestamp, MinKey, or MaxKey."
        )),
    }
}

/// Converts a value into BSON.
///
/// # Errors
///
/// Returns an error for a constructor that is not known or that has wrong arguments.
pub fn to_bson(value: &Value) -> Converted<Bson> {
    Ok(match value {
        Value::Null => Bson::Null,
        Value::Bool(value) => Bson::Boolean(*value),
        Value::Number(text) => number(text)?,
        Value::String(text) => Bson::String(text.clone()),
        Value::Array(items) => Bson::Array(items.iter().map(to_bson).collect::<Converted<_>>()?),
        Value::Object(_) => Bson::Document(to_document(value)?),
        Value::Regex { pattern, flags } => {
            let mut options: Vec<char> = flags.chars().collect();
            options.sort_unstable();
            Bson::RegularExpression(Regex {
                pattern: pattern.clone(),
                options: options.into_iter().collect(),
            })
        }
        Value::Constructor { name, args } => constructor(name, args)?,
    })
}

/// Converts an object into a document. The fields keep their sequence.
///
/// # Errors
///
/// Returns an error if the value is not an object, or if a field has no BSON form.
pub fn to_document(value: &Value) -> Converted<Document> {
    let Value::Object(fields) = value else {
        return error("Expected a document `{ … }`.");
    };
    let mut document = Document::new();
    for (key, value) in fields {
        document.insert(key.clone(), to_bson(value)?);
    }
    Ok(document)
}

/// Converts an optional argument into a document. No argument is an empty document.
///
/// # Errors
///
/// Returns an error if the argument is not an object.
pub fn optional_document(value: Option<&Value>) -> Converted<Document> {
    value.map_or_else(|| Ok(Document::new()), to_document)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::doc;
    use tabloxide_core::mongo::{Statement, parse_statement};

    fn first_arg(statement: &str) -> Value {
        match parse_statement(statement).unwrap() {
            Statement::Collection { method, .. } => method.args[0].clone(),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn converts_numbers_like_the_shell() {
        let value = first_arg("db.c.insertOne({ a: 1, b: 3000000000, c: 1.5, d: -2 })");

        assert_eq!(
            to_document(&value).unwrap(),
            doc! { "a": 1_i32, "b": 3_000_000_000_i64, "c": 1.5, "d": -2_i32 }
        );
    }

    #[test]
    fn converts_the_constructors() {
        let value = first_arg(
            "db.c.find({ id: ObjectId('65a1b2c3d4e5f6a7b8c9d0e1'), at: ISODate('2024-01-31'), n: NumberLong(5), dec: NumberDecimal('1.10'), r: /^a/mi })",
        );

        let document = to_document(&value).unwrap();

        assert_eq!(
            document.get_object_id("id").unwrap().to_hex(),
            "65a1b2c3d4e5f6a7b8c9d0e1"
        );
        assert_eq!(
            document
                .get_datetime("at")
                .unwrap()
                .try_to_rfc3339_string()
                .unwrap(),
            "2024-01-31T00:00:00Z"
        );
        assert_eq!(document.get_i64("n").unwrap(), 5);
        assert_eq!(document.get("dec").unwrap().to_string(), "1.10");
        assert_eq!(
            document.get("r"),
            Some(&Bson::RegularExpression(Regex {
                pattern: "^a".to_owned(),
                options: "im".to_owned(),
            }))
        );
    }

    #[test]
    fn refuses_a_bad_constructor_with_a_message() {
        let value = first_arg("db.c.find({ id: ObjectId('xyz') })");
        assert!(
            to_document(&value)
                .unwrap_err()
                .0
                .contains("not an ObjectId")
        );

        let value = first_arg("db.c.find({ x: Code('1') })");
        assert!(
            to_document(&value)
                .unwrap_err()
                .0
                .contains("not a known constructor")
        );
    }
}
