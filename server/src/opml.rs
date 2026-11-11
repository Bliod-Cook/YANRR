//! OPML, the outline format feed readers exchange subscriptions in.

use std::io;

use quick_xml::{
    Reader, Writer, XmlVersion,
    events::{BytesDecl, BytesStart, BytesText, Event},
};
use serde::Deserialize;

/// A feed in an OPML document.
#[derive(Debug, PartialEq, Deserialize)]
pub struct Outline {
    pub url: String,
    pub title: Option<String>,
    /// The folder holding the feed, the innermost one when folders nest.
    pub category: Option<String>,
}

/// The feeds in an OPML document, in document order.
pub fn parse(opml: &[u8]) -> Result<Vec<Outline>, String> {
    let mut reader = Reader::from_reader(opml);
    // Names of the open outlines; feeds count as unnamed, so their children stay in the enclosing folder.
    let mut open: Vec<Option<String>> = Vec::new();
    let mut feeds = Vec::new();
    loop {
        let event = reader.read_event().map_err(|err| err.to_string())?;
        let (element, empty) = match &event {
            Event::Start(element) => (element, false),
            Event::Empty(element) => (element, true),
            Event::End(element) if element.local_name().as_ref() == "outline" => {
                open.pop();
                continue;
            }
            Event::Eof => return Ok(feeds),
            _ => continue,
        };
        if element.local_name().as_ref() != "outline" {
            continue;
        }
        let [url, title, text] = attributes(element, ["xmlUrl", "title", "text"])?;
        let name = title.or(text);
        let folder = match url {
            Some(url) => {
                let category = open.iter().rev().find_map(Clone::clone);
                feeds.push(Outline {
                    url,
                    title: name,
                    category,
                });
                None
            }
            None => name,
        };
        if !empty {
            open.push(folder);
        }
    }
}

fn attributes<const N: usize>(
    element: &BytesStart,
    names: [&str; N],
) -> Result<[Option<String>; N], String> {
    let mut values = [const { None }; N];
    for attribute in element.attributes() {
        let attribute = attribute.map_err(|err| err.to_string())?;
        let key = attribute.key.local_name();
        if let Some(index) = names.iter().position(|name| *name == key.as_ref()) {
            let value = attribute
                .normalized_value(XmlVersion::Implicit1_0)
                .map_err(|err| err.to_string())?;
            values[index] = Some(value.into_owned()).filter(|value| !value.is_empty());
        }
    }
    Ok(values)
}

/// An OPML document listing `outlines`: feeds without a category at the top, the others in a folder per category.
pub fn write(outlines: &[Outline]) -> String {
    let mut writer = Writer::new_with_indent(Vec::new(), b' ', 2);
    document(&mut writer, outlines).expect("writing to memory cannot fail");
    String::from_utf8(writer.into_inner()).expect("quick-xml writes UTF-8")
}

fn document(writer: &mut Writer<Vec<u8>>, outlines: &[Outline]) -> io::Result<()> {
    let mut categories: Vec<&str> = Vec::new();
    for category in outlines
        .iter()
        .filter_map(|outline| outline.category.as_deref())
    {
        if !categories.contains(&category) {
            categories.push(category);
        }
    }
    writer.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))?;
    writer
        .create_element("opml")
        .with_attribute(("version", "2.0"))
        .write_inner_content(|writer| {
            writer
                .create_element("head")
                .write_inner_content(|writer| {
                    let title = BytesText::new("YANRR subscriptions");
                    writer.create_element("title").write_text_content(title)?;
                    Ok(())
                })?;
            writer
                .create_element("body")
                .write_inner_content(|writer| {
                    for outline in outlines.iter().filter(|outline| outline.category.is_none()) {
                        feed(writer, outline)?;
                    }
                    for category in categories {
                        writer
                            .create_element("outline")
                            .with_attributes([("text", category), ("title", category)])
                            .write_inner_content(|writer| {
                                for outline in outlines
                                    .iter()
                                    .filter(|outline| outline.category.as_deref() == Some(category))
                                {
                                    feed(writer, outline)?;
                                }
                                Ok(())
                            })?;
                    }
                    Ok(())
                })?;
            Ok(())
        })?;
    Ok(())
}

fn feed(writer: &mut Writer<Vec<u8>>, outline: &Outline) -> io::Result<()> {
    let title = outline.title.as_deref().unwrap_or(&outline.url);
    writer
        .create_element("outline")
        .with_attributes([
            ("type", "rss"),
            ("text", title),
            ("title", title),
            ("xmlUrl", &outline.url),
        ])
        .write_empty()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn written_documents_parse_back() {
        let outlines = [
            Outline {
                url: "https://a.example/feed?x=1&y=2".into(),
                title: Some("A <b>".into()),
                category: None,
            },
            Outline {
                url: "https://b.example/rss".into(),
                title: None,
                category: Some("News & Blogs".into()),
            },
        ];

        let parsed = parse(write(&outlines).as_bytes()).unwrap();

        assert_eq!(parsed[0], outlines[0]);
        // A feed without a title is written under its URL.
        assert_eq!(parsed[1].title.as_deref(), Some("https://b.example/rss"));
        assert_eq!(parsed[1].category, outlines[1].category);
    }
}
