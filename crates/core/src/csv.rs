//! CSV output for results (RFC 4180, UTF-8, line feed as the line end).
//!
//! NULL is an empty field without quotes. An empty string is `""`.
//! Thus a reader can see the difference between the two.

use crate::{Column, QueryError, QueryErrorKind, ResultStream};
use tokio::io::{AsyncWrite, AsyncWriteExt};

fn needs_quotes(value: &str) -> bool {
    value.is_empty() || value.contains(['"', ',', '\n', '\r'])
}

fn push_field(line: &mut String, value: Option<&str>) {
    match value {
        None => {}
        Some(value) if needs_quotes(value) => {
            line.push('"');
            line.push_str(&value.replace('"', "\"\""));
            line.push('"');
        }
        Some(value) => line.push_str(value),
    }
}

/// Adds one record and the line end to `out`.
pub fn push_record<'a>(out: &mut String, fields: impl IntoIterator<Item = Option<&'a str>>) {
    for (index, field) in fields.into_iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        push_field(out, field);
    }
    out.push('\n');
}

fn write_error(error: &std::io::Error) -> QueryError {
    QueryError::new(
        QueryErrorKind::Other,
        format!("Cannot write the file: {error}"),
    )
}

/// Reads `stream` to its end and writes the header and all rows to `out`.
/// Returns the number of rows. Memory use does not depend on the number of rows.
///
/// # Errors
///
/// Returns the error of the statement, or an error of kind `Other` if the write fails.
pub async fn export_csv<W>(
    stream: &mut dyn ResultStream,
    out: &mut W,
    page_rows: usize,
) -> Result<u64, QueryError>
where
    W: AsyncWrite + Unpin + Send,
{
    let mut text = String::new();
    let columns = stream.columns().map(<[Column]>::to_vec).unwrap_or_default();
    push_record(&mut text, columns.iter().map(|c| Some(c.name.as_str())));
    let mut count = 0_u64;
    loop {
        let page = stream.next_page(page_rows).await?;
        for row in &page.rows {
            push_record(&mut text, row.iter().map(Option::as_deref));
        }
        count += page.rows.len() as u64;
        out.write_all(text.as_bytes())
            .await
            .map_err(|e| write_error(&e))?;
        text.clear();
        if page.end.is_some() {
            out.flush().await.map_err(|e| write_error(&e))?;
            return Ok(count);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Session;
    use crate::testing::{Scripted, ScriptedSession};

    fn record(fields: &[Option<&str>]) -> String {
        let mut out = String::new();
        push_record(&mut out, fields.iter().copied());
        out
    }

    #[test]
    fn writes_plain_fields_without_quotes() {
        assert_eq!(
            record(&[Some("a"), Some("1.5"), Some("x y")]),
            "a,1.5,x y\n"
        );
    }

    #[test]
    fn null_and_the_empty_string_are_different() {
        assert_eq!(record(&[None, Some(""), None]), ",\"\",\n");
    }

    #[test]
    fn quotes_fields_that_have_special_characters() {
        assert_eq!(
            record(&[Some("a,b"), Some("say \"hi\""), Some("line\nbreak")]),
            "\"a,b\",\"say \"\"hi\"\"\",\"line\nbreak\"\n"
        );
    }

    #[tokio::test]
    async fn exports_the_header_and_all_rows() {
        let (mut session, _) = ScriptedSession::new([Scripted::Rows(5)]);
        let mut stream = session.execute("select").await.unwrap();
        let mut out: Vec<u8> = Vec::new();

        let count = export_csv(stream.as_mut(), &mut out, 2).await.unwrap();

        assert_eq!(count, 5);
        assert_eq!(String::from_utf8(out).unwrap(), "n\n1\n2\n3\n4\n5\n");
    }
}
