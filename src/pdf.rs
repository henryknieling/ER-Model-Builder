use std::fmt::Write as _;

use axum::{
    Json,
    body::Body,
    http::{HeaderValue, StatusCode, header},
    response::Response,
};
use serde::Deserialize;
use svg2pdf::{
    ConversionOptions, PageOptions,
    usvg::{Options, Tree},
};

const ENTITY_WIDTH: f64 = 170.0;
const ENTITY_HEIGHT: f64 = 58.0;
const ATTRIBUTE_RX: f64 = 72.0;
const ATTRIBUTE_RY: f64 = 25.0;
const PADDING: f64 = 55.0;

#[derive(Deserialize)]
pub struct Model {
    version: u8,
    name: String,
    entities: Vec<Entity>,
    relationships: Vec<Relationship>,
}

#[derive(Deserialize)]
struct Entity {
    id: String,
    name: String,
    x: f64,
    y: f64,
    attributes: Vec<Attribute>,
}

#[derive(Deserialize)]
struct Attribute {
    name: String,
    #[serde(rename = "type")]
    data_type: String,
    pk: bool,
    nullable: bool,
    unique: bool,
    #[serde(default)]
    x: Option<f64>,
    #[serde(default)]
    y: Option<f64>,
}

#[derive(Deserialize)]
struct Relationship {
    name: String,
    from: String,
    to: String,
    cardinality: String,
}

pub async fn download_pdf(Json(model): Json<Model>) -> Result<Response, (StatusCode, String)> {
    validate(&model)?;
    let svg = render_svg(&model);
    let mut options = Options::default();
    options.fontdb_mut().load_system_fonts();
    let tree = Tree::from_str(&svg, &options).map_err(|error| {
        (
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("Could not render diagram: {error}"),
        )
    })?;
    let pdf = svg2pdf::to_pdf(&tree, ConversionOptions::default(), PageOptions::default())
        .map_err(|error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Could not create PDF: {error}"),
            )
        })?;

    let filename = format!("{}.pdf", safe_filename(&model.name));
    let mut response = Response::new(Body::from(pdf));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/pdf"),
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{filename}\""))
            .expect("sanitized filename is a valid header value"),
    );
    Ok(response)
}

fn validate(model: &Model) -> Result<(), (StatusCode, String)> {
    let invalid = |message: &str| (StatusCode::UNPROCESSABLE_ENTITY, message.to_owned());
    if model.version != 1 {
        return Err(invalid("Unsupported model version."));
    }
    if model.name.trim().is_empty() || model.name.len() > 160 {
        return Err(invalid(
            "Model name is required and must be at most 160 characters.",
        ));
    }
    if model.entities.len() > 500 || model.relationships.len() > 1000 {
        return Err(invalid("Model exceeds the supported size."));
    }

    let mut ids = std::collections::HashSet::new();
    for entity in &model.entities {
        if entity.id.is_empty() || !ids.insert(entity.id.as_str()) {
            return Err(invalid("Entity IDs must be unique."));
        }
        if entity.name.trim().is_empty()
            || entity.name.len() > 160
            || !entity.x.is_finite()
            || !entity.y.is_finite()
            || entity.x.abs() > 100_000.0
            || entity.y.abs() > 100_000.0
        {
            return Err(invalid("An entity has an invalid name or canvas position."));
        }
        if entity.attributes.len() > 200 {
            return Err(invalid("An entity has too many attributes."));
        }
        if entity.attributes.iter().any(|attribute| {
            attribute.name.trim().is_empty()
                || attribute.name.len() > 160
                || attribute.data_type.trim().is_empty()
                || attribute.data_type.len() > 80
                || attribute
                    .x
                    .is_some_and(|x| !x.is_finite() || x.abs() > 100_000.0)
                || attribute
                    .y
                    .is_some_and(|y| !y.is_finite() || y.abs() > 100_000.0)
        }) {
            return Err(invalid("An attribute has an invalid name or data type."));
        }
    }
    for relationship in &model.relationships {
        if relationship.name.trim().is_empty()
            || !ids.contains(relationship.from.as_str())
            || !ids.contains(relationship.to.as_str())
            || !["1:1", "1:n", "n:1", "n:m"]
                .contains(&relationship.cardinality.to_lowercase().as_str())
        {
            return Err(invalid(
                "A relationship has an invalid name, endpoint, or cardinality.",
            ));
        }
    }
    Ok(())
}

fn render_svg(model: &Model) -> String {
    let mut min_x: f64 = 0.0;
    let mut min_y: f64 = 0.0;
    let mut max_x: f64 = 650.0;
    let mut max_y: f64 = 380.0;
    for entity in &model.entities {
        min_y = min_y.min(entity.y - 20.0);
        max_y = max_y.max(entity.y + ENTITY_HEIGHT + 30.0);
        for (index, attribute) in entity.attributes.iter().enumerate() {
            let (x, y) = attribute_center(entity, attribute, index);
            min_x = min_x.min(x - ATTRIBUTE_RX - 20.0);
            max_x = max_x.max(x + ATTRIBUTE_RX + 20.0);
            min_y = min_y.min(y - ATTRIBUTE_RY - 20.0);
            max_y = max_y.max(y + ATTRIBUTE_RY + 20.0);
        }
    }
    for relationship in &model.relationships {
        if let (Some(from), Some(to)) = (
            model
                .entities
                .iter()
                .find(|entity| entity.id == relationship.from),
            model
                .entities
                .iter()
                .find(|entity| entity.id == relationship.to),
        ) {
            let from_center = center(from);
            let to_center = center(to);
            let half_width = (relationship.name.chars().count() as f64 * 4.0 + 29.0).max(56.0);
            let half_height = 29.0;
            min_x = min_x.min((from_center.0 + to_center.0) / 2.0 - half_width - 20.0);
            max_x = max_x.max((from_center.0 + to_center.0) / 2.0 + half_width + 20.0);
            min_y = min_y.min((from_center.1 + to_center.1) / 2.0 - half_height - 20.0);
            max_y = max_y.max((from_center.1 + to_center.1) / 2.0 + half_height + 20.0);
        }
    }
    let width = max_x - min_x + PADDING * 2.0;
    let height = max_y - min_y + PADDING * 2.0;
    let mut svg = String::new();
    let _ = write!(
        svg,
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}\" height=\"{height}\" viewBox=\"{} {} {width} {height}\"><rect x=\"{}\" y=\"{}\" width=\"{width}\" height=\"{height}\" fill=\"white\"/>",
        min_x - PADDING,
        min_y - PADDING,
        min_x - PADDING,
        min_y - PADDING
    );
    let _ = write!(
        svg,
        "<text x=\"{}\" y=\"{}\" font-family=\"sans-serif\" font-size=\"20\" font-weight=\"bold\" fill=\"#20233a\">{}</text>",
        min_x,
        min_y - 15.0,
        escape_xml(&model.name)
    );

    for relationship in &model.relationships {
        let Some(from) = model
            .entities
            .iter()
            .find(|entity| entity.id == relationship.from)
        else {
            continue;
        };
        let Some(to) = model
            .entities
            .iter()
            .find(|entity| entity.id == relationship.to)
        else {
            continue;
        };
        let (x1, y1) = center(from);
        let (x2, y2) = center(to);
        let mid_x = (x1 + x2) / 2.0;
        let mid_y = (y1 + y2) / 2.0;
        let half_width = (relationship.name.chars().count() as f64 * 4.0 + 29.0).max(56.0);
        let half_height = 29.0;
        let (sx, sy) = rect_edge(x1, y1, mid_x, mid_y);
        let (ex, ey) = rect_edge(x2, y2, mid_x, mid_y);
        let (dx1, dy1) = diamond_edge(mid_x, mid_y, sx, sy, half_width, half_height);
        let (dx2, dy2) = diamond_edge(mid_x, mid_y, ex, ey, half_width, half_height);
        let _ = write!(
            svg,
            "<line x1=\"{sx}\" y1=\"{sy}\" x2=\"{dx1}\" y2=\"{dy1}\" stroke=\"#73778a\" stroke-width=\"1.5\"/><line x1=\"{ex}\" y1=\"{ey}\" x2=\"{dx2}\" y2=\"{dy2}\" stroke=\"#73778a\" stroke-width=\"1.5\"/><text x=\"{}\" y=\"{}\" font-family=\"sans-serif\" font-size=\"11\" text-anchor=\"middle\" fill=\"#55596d\">{}</text><polygon points=\"{mid_x},{} {},{mid_y} {mid_x},{} {},{mid_y}\" fill=\"white\" stroke=\"#214777\" stroke-width=\"1.7\"/><text x=\"{mid_x}\" y=\"{}\" font-family=\"sans-serif\" font-size=\"10\" text-anchor=\"middle\" fill=\"#34374d\">{}</text>",
            sx + (dx1 - sx) * 0.33,
            sy + (dy1 - sy) * 0.33 - 5.0,
            escape_xml(&relationship.cardinality.split(':').next().unwrap_or("1")),
            mid_y - half_height,
            mid_x + half_width,
            mid_y + half_height,
            mid_x - half_width,
            mid_y + 3.5,
            escape_xml(&relationship.name)
        );
        let _ = write!(
            svg,
            "<text x=\"{}\" y=\"{}\" font-family=\"sans-serif\" font-size=\"11\" text-anchor=\"middle\" fill=\"#55596d\">{}</text>",
            ex + (dx2 - ex) * 0.33,
            ey + (dy2 - ey) * 0.33 - 5.0,
            escape_xml(relationship.cardinality.split(':').nth(1).unwrap_or("N"))
        );
    }

    for entity in &model.entities {
        let _ = write!(
            svg,
            "<rect x=\"{}\" y=\"{}\" width=\"{ENTITY_WIDTH}\" height=\"{ENTITY_HEIGHT}\" rx=\"3\" fill=\"white\" stroke=\"#214777\" stroke-width=\"1.7\"/><text x=\"{}\" y=\"{}\" font-family=\"sans-serif\" font-size=\"13\" font-weight=\"bold\" text-anchor=\"middle\" fill=\"#292c43\">{}</text>",
            entity.x,
            entity.y,
            entity.x + ENTITY_WIDTH / 2.0,
            entity.y + 35.0,
            escape_xml(&entity.name)
        );
        for (index, attribute) in entity.attributes.iter().enumerate() {
            let (cx, cy) = attribute_center(entity, attribute, index);
            let (entity_cx, entity_cy) = center(entity);
            let (line_x1, line_y1) = rect_edge(entity_cx, entity_cy, cx, cy);
            let (line_x2, line_y2) = ellipse_edge(cx, cy, line_x1, line_y1);
            let _ = write!(
                svg,
                "<line x1=\"{line_x1}\" y1=\"{line_y1}\" x2=\"{line_x2}\" y2=\"{line_y2}\" stroke=\"#9a9daf\" stroke-width=\"1\"/><ellipse cx=\"{cx}\" cy=\"{cy}\" rx=\"{ATTRIBUTE_RX}\" ry=\"{ATTRIBUTE_RY}\" fill=\"white\" stroke=\"#7b7f91\" stroke-width=\"1.3\"/><text x=\"{cx}\" y=\"{}\" font-family=\"sans-serif\" font-size=\"10\" text-anchor=\"middle\" fill=\"#42465c\"><tspan{}>{}</tspan><tspan x=\"{cx}\" dy=\"12\" font-size=\"8\" fill=\"#85899d\">{}</tspan></text>",
                cy - 2.0,
                if attribute.pk {
                    " text-decoration=\"underline\""
                } else {
                    ""
                },
                escape_xml(&attribute.name),
                escape_xml(&attribute_summary(attribute))
            );
        }
    }
    svg.push_str("</svg>");
    svg
}

fn center(entity: &Entity) -> (f64, f64) {
    (
        entity.x + ENTITY_WIDTH / 2.0,
        entity.y + ENTITY_HEIGHT / 2.0,
    )
}

fn attribute_center(entity: &Entity, attribute: &Attribute, index: usize) -> (f64, f64) {
    let row = (index / 2) as f64;
    let default_x = entity.x
        + if index % 2 == 0 {
            -100.0
        } else {
            ENTITY_WIDTH + 100.0
        };
    (
        attribute.x.unwrap_or(default_x),
        attribute.y.unwrap_or(entity.y + 29.0 + row * 58.0),
    )
}

fn ellipse_edge(cx: f64, cy: f64, toward_x: f64, toward_y: f64) -> (f64, f64) {
    let dx = toward_x - cx;
    let dy = toward_y - cy;
    let scale = ((dx * dx) / (ATTRIBUTE_RX * ATTRIBUTE_RX)
        + (dy * dy) / (ATTRIBUTE_RY * ATTRIBUTE_RY))
        .sqrt();
    if scale == 0.0 {
        (cx, cy)
    } else {
        (cx + dx / scale, cy + dy / scale)
    }
}

fn rect_edge(cx: f64, cy: f64, toward_x: f64, toward_y: f64) -> (f64, f64) {
    let dx = toward_x - cx;
    let dy = toward_y - cy;
    if dx == 0.0 && dy == 0.0 {
        return (cx, cy);
    }
    let scale_x = if dx == 0.0 {
        f64::INFINITY
    } else {
        (ENTITY_WIDTH / 2.0) / dx.abs()
    };
    let scale_y = if dy == 0.0 {
        f64::INFINITY
    } else {
        (ENTITY_HEIGHT / 2.0) / dy.abs()
    };
    let scale = scale_x.min(scale_y);
    (cx + dx * scale, cy + dy * scale)
}

fn diamond_edge(
    cx: f64,
    cy: f64,
    toward_x: f64,
    toward_y: f64,
    half_width: f64,
    half_height: f64,
) -> (f64, f64) {
    let dx = toward_x - cx;
    let dy = toward_y - cy;
    let denominator = dx.abs() / half_width + dy.abs() / half_height;
    if denominator == 0.0 {
        (cx, cy)
    } else {
        (cx + dx / denominator, cy + dy / denominator)
    }
}

fn attribute_summary(attribute: &Attribute) -> String {
    let mut flags = vec![attribute.data_type.as_str()];
    if attribute.unique {
        flags.push("unique");
    }
    if attribute.nullable {
        flags.push("nullable");
    }
    flags.join(" · ")
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn safe_filename(name: &str) -> String {
    let slug: String = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        "er-model".to_owned()
    } else {
        slug.chars().take(64).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn example_model() -> Model {
        Model {
            version: 1,
            name: "Shop model".to_owned(),
            entities: vec![
                Entity {
                    id: "customer".to_owned(),
                    name: "Customer".to_owned(),
                    x: 130.0,
                    y: 150.0,
                    attributes: vec![Attribute {
                        name: "customer_id".to_owned(),
                        data_type: "integer".to_owned(),
                        pk: true,
                        nullable: false,
                        unique: true,
                        x: Some(30.0),
                        y: Some(179.0),
                    }],
                },
                Entity {
                    id: "order".to_owned(),
                    name: "Order".to_owned(),
                    x: 570.0,
                    y: 150.0,
                    attributes: vec![],
                },
            ],
            relationships: vec![Relationship {
                name: "places".to_owned(),
                from: "customer".to_owned(),
                to: "order".to_owned(),
                cardinality: "1:n".to_owned(),
            }],
        }
    }

    #[test]
    fn renders_a_valid_er_diagram_pdf() {
        let svg = render_svg(&example_model());
        assert!(svg.contains("<ellipse"));
        assert!(svg.contains("<polygon"));
        let mut options = Options::default();
        options.fontdb_mut().load_system_fonts();
        let tree = Tree::from_str(&svg, &options).expect("diagram SVG parses");
        let pdf = svg2pdf::to_pdf(&tree, ConversionOptions::default(), PageOptions::default())
            .expect("SVG converts to PDF");
        assert!(pdf.starts_with(b"%PDF-"));
    }

    #[test]
    fn rejects_invalid_pdf_models() {
        let mut model = example_model();
        model.relationships[0].to = "missing".to_owned();
        assert_eq!(
            validate(&model).unwrap_err().0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
}
