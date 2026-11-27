//! Plain explanations of the stages and the fields of a MongoDB plan.

use tabloxide_core::FieldGroup;

/// Returns the explanation of a stage, or `None` for an unknown stage.
pub(super) fn stage_text(stage: &str) -> Option<String> {
    let text = match stage {
        "COLLSCAN" => {
            "Reads all documents of the collection and keeps the documents that agree with the filter."
        }
        "IXSCAN" | "EXPRESS_IXSCAN" => {
            "Reads the keys of an index in a range. It gives the positions of the documents, not the documents."
        }
        "CLUSTERED_IXSCAN" | "EXPRESS_CLUSTERED_IXSCAN" => {
            "Reads a range of a clustered collection in the sequence of its key."
        }
        "FETCH" => {
            "Reads each document at the position that the step below it gives. A filter on this step checks fields that the index does not have."
        }
        "IDHACK" | "EXPRESS_IDHACK" => "Finds one document by its _id. This is the fastest read.",
        "SORT" => {
            "Sorts the documents in memory. It must read all its input before it gives the first document."
        }
        "SORT_KEY_GENERATOR" => "Makes the sort keys for the sort above it.",
        "SORT_MERGE" => "Merges inputs that each come sorted. It keeps the sequence.",
        "PROJECTION_SIMPLE" | "PROJECTION_DEFAULT" => {
            "Keeps only the fields of the projection in each document."
        }
        "PROJECTION_COVERED" => {
            "Makes the result from the index keys only. MongoDB does not read the documents."
        }
        "LIMIT" => "Stops after the number of documents of the limit.",
        "SKIP" => "Skips the first documents of its input.",
        "COUNT" => "Counts the documents of its input.",
        "COUNT_SCAN" => "Counts the keys of an index in a range. It does not read the documents.",
        "RECORD_STORE_FAST_COUNT" => {
            "Gives the count of the collection from its metadata, without a read."
        }
        "DISTINCT_SCAN" => "Reads one key for each different value of an index.",
        "SHARDING_FILTER" => "Removes documents that belong to a different shard.",
        "OR" => "Combines the results of more than one index scan for an $or condition.",
        "AND_HASH" | "AND_SORTED" => {
            "Keeps only the documents that all its inputs give (index intersection)."
        }
        "TEXT_MATCH" | "TEXT_OR" => "Finds documents with a text index.",
        "GEO_NEAR_2D" | "GEO_NEAR_2DSPHERE" => {
            "Finds documents near a point with a geospatial index, nearest first."
        }
        "GROUP" => "Groups the documents by the key of $group and calculates the accumulators.",
        "EQ_LOOKUP" => "Joins documents of a different collection by equal values ($lookup).",
        "UNWIND" => "Makes one document for each item of an array.",
        "UPDATE" => "Changes the documents of its input.",
        "DELETE" | "BATCHED_DELETE" => "Deletes the documents of its input.",
        "CACHED_PLAN" => "Uses a plan from the plan cache of the collection.",
        "SUBPLAN" => "Selects a plan for each branch of an $or condition.",
        "MULTI_PLAN" => "Tries more than one plan and keeps the fastest.",
        "EOF" => "Gives no documents, for example because the collection does not exist.",
        "$sort" => "Sorts the documents of the pipeline. Without an index, it sorts in memory.",
        "$group" => "Groups the documents by its _id expression and calculates the accumulators.",
        "$lookup" => {
            "Joins documents of a different collection. For each input document, it reads the other collection."
        }
        "$unwind" => "Makes one document for each item of an array.",
        "$project" | "$addFields" | "$set" | "$unset" => "Changes the fields of each document.",
        "$match" => "Keeps the documents that agree with the condition.",
        "$limit" => "Stops after the number of documents of the limit.",
        "$skip" => "Skips the first documents of its input.",
        "$count" => "Counts the documents of its input.",
        "$facet" => "Runs more than one pipeline on the same input documents.",
        "$sortByCount" => "Groups the documents by a value and sorts the groups by their count.",
        "$bucket" | "$bucketAuto" => "Puts the documents into groups by ranges of a value.",
        "$replaceRoot" | "$replaceWith" => "Replaces each document with a different document.",
        "$out" | "$merge" => "Writes the result into a collection.",
        _ => return None,
    };
    Some(text.to_owned())
}

/// `true` if the stage reads the documents of the collection, not of an index.
pub(super) fn reads_collection(stage: &str) -> bool {
    matches!(
        stage,
        "COLLSCAN" | "CLUSTERED_IXSCAN" | "EXPRESS_CLUSTERED_IXSCAN" | "RECORD_STORE_FAST_COUNT"
    )
}

/// Returns the group and the explanation of a field.
pub(super) fn field_info(name: &str) -> (FieldGroup, Option<&'static str>) {
    let measured = |text| (FieldGroup::Measured, Some(text));
    let step = |text| (FieldGroup::Step, Some(text));
    let memory = |text| (FieldGroup::Memory, Some(text));
    match name {
        "nReturned" => measured("The documents or keys that the step gave to the step above it."),
        "executionTimeMillisEstimate" => measured(
            "The time of the step with its child steps, in milliseconds. It is an estimate.",
        ),
        "docsExamined" | "totalDocsExamined" => {
            measured("The documents that the step read. Compare it with nReturned.")
        }
        "keysExamined" | "totalKeysExamined" => {
            measured("The index keys that the step read. Compare it with nReturned.")
        }
        "works" => measured("The units of work of the step. Each read or each result is one unit."),
        "advanced" => measured("The results that the step gave to the step above it."),
        "needTime" => measured("The units of work that gave no result to the step above it."),
        "needYield" => measured("The times that the step stopped for other operations."),
        "seeks" => {
            measured("The times that the index scan moved to a different place in the index.")
        }
        "collectionScans" => {
            measured("The times that $lookup read the other collection without an index.")
        }
        "indexesUsed" => measured("The indexes that $lookup used on the other collection."),
        "nCounted" => measured("The documents that the count step counted."),
        "filter" => step("The condition that the step checks on each document."),
        "keyPattern" => {
            step("The fields of the index, with 1 for ascending and -1 for descending.")
        }
        "indexBounds" => step("The ranges of the index that the scan reads."),
        "direction" => step("The direction of the scan: forward or backward."),
        "sortPattern" | "sortKey" => {
            step("The fields of the sort, with 1 for ascending and -1 for descending.")
        }
        "limitAmount" => step("The sort keeps only this number of documents (top-k sort)."),
        "isMultiKey" => {
            step("The index has a field with array values. Then one document can have more keys.")
        }
        "namespace" => step("The database and the collection."),
        "parsedQuery" => step("The filter after MongoDB read and normalized it."),
        "indexFilterSet" => {
            step("An index filter of the collection limits the indexes that the planner can use.")
        }
        "rejectedPlans" => {
            step("The number of other plans that the planner tried and did not use.")
        }
        "memLimit" => memory(
            "The memory that the sort can use, in bytes. A larger sort writes to disk or fails.",
        ),
        "usedDisk" => memory("The step wrote data to disk because the data did not fit in memory."),
        "spills" | "spilledBytes" | "spilledRecords" | "spilledDataStorageSize" => {
            memory("Data that the step wrote to disk because the memory was too small.")
        }
        "totalDataSizeSorted" | "totalDataSizeSortedBytesEstimate" => {
            memory("The size of the data that the sort sorted, in bytes.")
        }
        _ => (default_group(name), None),
    }
}

fn default_group(name: &str) -> FieldGroup {
    let lower = name.to_ascii_lowercase();
    if lower.contains("spill") || lower.contains("disk") || lower.contains("mem") {
        FieldGroup::Memory
    } else if matches!(
        name,
        "saveState"
            | "restoreState"
            | "isEOF"
            | "opens"
            | "closes"
            | "alreadyHasObj"
            | "dupsTested"
            | "dupsDropped"
            | "nSkipped"
    ) {
        FieldGroup::Measured
    } else {
        FieldGroup::Step
    }
}
