/** B4 slice 2: the most live inference items one guidance request carries.
 * A running worker job cannot be pre-empted; this bounds how long one batch
 * can hold the reader's worker. Shared by the page sender and the worker. */
export const LIVE_INFERENCE_BATCH_LIMIT = 64;
/** B4 F2: the most identified field ids one `project-reader-field-names`
 * request carries (the page batches, the worker refuses more). */
export const READER_FIELD_NAMES_LIMIT = 256;
