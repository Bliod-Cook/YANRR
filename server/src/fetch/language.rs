use whatlang::Lang;

/// ISO 639-1 code of the text's language, if it can be told reliably.
pub fn detect(text: &str) -> Option<String> {
    let info = whatlang::detect(text).filter(|info| info.is_reliable())?;
    let code = match info.lang() {
        // Mandarin has no ISO 639-1 code of its own.
        Lang::Cmn => "zh",
        lang => isolang::Language::from_639_3(lang.code())?.to_639_1()?,
    };
    Some(code.into())
}
