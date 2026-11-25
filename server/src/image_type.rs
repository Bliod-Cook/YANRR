//! Raster images, typed by their leading bytes rather than by what the sender claimed.

/// How many leading bytes [`sniff`] needs.
pub const HEAD_LEN: usize = 12;

/// The media type of the raster image that starts with `head`; `None` for anything else, SVG included, which runs
/// its scripts when opened from the origin that serves it.
pub fn sniff(head: &[u8]) -> Option<&'static str> {
    let at = |range: std::ops::Range<usize>| head.get(range).unwrap_or_default();
    let content_type = match head {
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        [0, 0, 1, 0, ..] => "image/x-icon",
        [b'G', b'I', b'F', b'8', ..] => "image/gif",
        [0xFF, 0xD8, 0xFF, ..] => "image/jpeg",
        _ if at(0..4) == b"RIFF" && at(8..12) == b"WEBP" => "image/webp",
        // An ISO media file whose major brand is AVIF, still or animated
        _ if at(4..8) == b"ftyp" && matches!(at(8..12), b"avif" | b"avis") => "image/avif",
        _ => return None,
    };
    Some(content_type)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn types_raster_images_by_their_leading_bytes() {
        let cases: &[(&[u8], Option<&str>)] = &[
            (b"\x89PNG\r\n\x1a\n", Some("image/png")),
            (&[0, 0, 1, 0, 1, 0], Some("image/x-icon")),
            (b"GIF89a", Some("image/gif")),
            (&[0xFF, 0xD8, 0xFF, 0xE0], Some("image/jpeg")),
            (b"RIFF\0\0\0\0WEBPVP8 ", Some("image/webp")),
            (b"\0\0\0\x1cftypavif", Some("image/avif")),
            (b"\0\0\0\x1cftypavis", Some("image/avif")),
            (b"<svg xmlns=\"http://www.w3.org/2000/svg\">", None),
            (b"<!doctype html>", None),
            (b"", None),
        ];
        for (head, expected) in cases {
            assert_eq!(sniff(head), *expected, "{head:?}");
        }
    }
}
