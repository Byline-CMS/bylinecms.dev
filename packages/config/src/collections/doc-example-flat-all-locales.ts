const doc_flat_locale_all = {
  document_version_id: "01981ef7-6782-71a7-a779-3e36d9b2bc05",
  document_id: "01981ef7-6782-71a7-a779-432fe33aaa80",
  path: "my-first-bulk-document-13325",
  status: "draft",
  created_at: "2025-07-18T19:16:27.138Z",
  updated_at: "2025-07-18T19:16:27.138Z",
  fields: [
    {
      field_path: "path",
      field_name: "path",
      locale: "all",
      field_type: "text",
      value: "my-first-bulk-document-13325"
    },
    {
      field_path: "publishedOn",
      field_name: "publishedOn",
      locale: "all",
      field_type: "datetime",
      date_type: "datetime",
      value_time: null,
      value_date: null,
      value_timestamp_tz: "2024-01-15 03:00:00+00"
    },
    {
      field_path: "title",
      field_name: "title",
      locale: "en",
      field_type: "text",
      value: "A bulk created document. 981"
    },
    {
      field_path: "title",
      field_name: "title",
      locale: "es",
      field_type: "text",
      value: "Mi Primer Documento"
    },
    {
      field_path: "summary",
      field_name: "summary",
      locale: "en",
      field_type: "text",
      value: "This is a sample document for testing purposes."
    },
    {
      field_path: "summary",
      field_name: "summary",
      locale: "es",
      field_type: "text",
      value: "Este es un documento de muestra para fines de prueba."
    },
    {
      field_path: "featured",
      field_name: "featured",
      locale: "all",
      field_type: "boolean",
      value: false
    },
    {
      field_path: "content.0.richTextBlock.0.constrainedWidth",
      field_name: "constrainedWidth",
      locale: "all",
      parent_path: "content.0.richTextBlock.0",
      field_type: "boolean",
      value: true
    },
    {
      field_path: "content.0.richTextBlock.1.richText",
      field_name: "richText",
      locale: "en",
      parent_path: "content.0.richTextBlock.1",
      field_type: "richText",
      value: {
        root: {
          type: "root",
          format: "",
          indent: 0,
          version: 1,
          children: [
            {
              type: "paragraph",
              format: "",
              indent: 0,
              version: 1,
              children: [
                {
                  mode: "normal",
                  text: "Some richtext here...",
                  type: "text",
                  style: "",
                  detail: 0,
                  format: 0,
                  version: 1
                }
              ],
              direction: "ltr",
              textStyle: "",
              textFormat: 0
            }
          ],
          direction: "ltr"
        }
      }
    },
    {
      field_path: "content.0.richTextBlock.1.richText",
      field_name: "richText",
      locale: "es",
      parent_path: "content.0.richTextBlock.1",
      field_type: "richText",
      value: {
        root: {
          type: "root",
          format: "",
          indent: 0,
          version: 1,
          children: [
            {
              type: "paragraph",
              format: "",
              indent: 0,
              version: 1,
              children: [
                {
                  mode: "normal",
                  text: "Aquí hay un campo de texto enriquecido...",
                  type: "text",
                  style: "",
                  detail: 0,
                  format: 0,
                  version: 1
                }
              ],
              direction: "ltr",
              textStyle: "",
              textFormat: 0
            }
          ],
          direction: "ltr"
        }
      }
    },
    {
      field_path: "content.1.photoBlock.0.display",
      field_name: "display",
      locale: "all",
      parent_path: "content.1.photoBlock.0",
      field_type: "text",
      value: "wide"
    },
    {
      field_path: "content.1.photoBlock.1.photo",
      field_name: "photo",
      locale: "all",
      parent_path: "content.1.photoBlock.1",
      field_type: "file",
      file_id: "01981ef7-2e41-7084-add9-3bf27c9b27c3",
      filename: "docs-photo-01.jpg",
      original_filename: "some-original-filename.jpg",
      mime_type: "image/jpeg",
      file_size: "123456",
      storage_provider: "local",
      storage_path: "uploads/docs-photo-01.jpg",
      storage_url: null,
      file_hash: null,
      image_width: null,
      image_height: null,
      image_format: null,
      processing_status: "pending",
      thumbnail_generated: false
    },
    {
      field_path: "content.1.photoBlock.2.alt",
      field_name: "alt",
      locale: "all",
      parent_path: "content.1.photoBlock.2",
      field_type: "text",
      value: "Some alt text here"
    },
    {
      field_path: "content.1.photoBlock.3.caption",
      field_name: "caption",
      locale: "en",
      parent_path: "content.1.photoBlock.3",
      field_type: "richText",
      value: {
        root: {
          type: "root",
          format: "",
          indent: 0,
          version: 1,
          children: [
            {
              type: "paragraph",
              format: "",
              indent: 0,
              version: 1,
              children: [
                {
                  mode: "normal",
                  text: "Here is a richtext field Here is a richtext field Here is a richtext field Here is a rich text field.",
                  type: "text",
                  style: "",
                  detail: 0,
                  format: 0,
                  version: 1
                }
              ],
              direction: "ltr",
              textStyle: "",
              textFormat: 0
            }
          ],
          direction: "ltr"
        }
      }
    },
    {
      field_path: "content.1.photoBlock.3.caption",
      field_name: "caption",
      locale: "es",
      parent_path: "content.1.photoBlock.3",
      field_type: "richText",
      value: {
        root: {
          type: "root",
          format: "",
          indent: 0,
          version: 1,
          children: [
            {
              type: "paragraph",
              format: "",
              indent: 0,
              version: 1,
              children: [
                {
                  mode: "normal",
                  text: "Aquí hay un campo de texto enriquecido. Aquí hay un campo de texto enriquecido. Aquí hay un campo de texto enriquecido. Aquí hay un campo de texto enriquecido.",
                  type: "text",
                  style: "",
                  detail: 0,
                  format: 0,
                  version: 1
                }
              ],
              direction: "ltr",
              textStyle: "",
              textFormat: 0
            }
          ],
          direction: "ltr"
        }
      }
    },
    {
      field_path: "links.0.link",
      field_name: "link",
      locale: "all",
      parent_path: "links.0",
      field_type: "text",
      value: "https://example.com"
    },
    {
      field_path: "links.1.link",
      field_name: "link",
      locale: "all",
      parent_path: "links.1",
      field_type: "text",
      value: "https://another-example.com"
    },
    {
      field_path: "reviews.0.reviewItem.0.rating",
      field_name: "rating",
      locale: "all",
      parent_path: "reviews.0.reviewItem.0",
      field_type: "integer",
      number_type: "integer",
      value_integer: 5,
      value_decimal: null,
      value_float: null
    },
    {
      field_path: "reviews.0.reviewItem.1.comment",
      field_name: "comment",
      locale: "all",
      parent_path: "reviews.0.reviewItem.1",
      field_type: "richText",
      value: {
        root: {
          type: "root",
          format: "",
          indent: 0,
          version: 1,
          children: [
            {
              type: "paragraph",
              format: "",
              indent: 0,
              version: 1,
              children: [
                {
                  mode: "normal",
                  text: "Some review text here...",
                  type: "text",
                  style: "",
                  detail: 0,
                  format: 0,
                  version: 1
                }
              ],
              direction: "ltr",
              textStyle: "",
              textFormat: 0
            }
          ],
          direction: "ltr"
        }
      }
    },
    {
      field_path: "reviews.1.reviewItem.0.rating",
      field_name: "rating",
      locale: "all",
      parent_path: "reviews.1.reviewItem.0",
      field_type: "integer",
      number_type: "integer",
      value_integer: 3,
      value_decimal: null,
      value_float: null
    },
    {
      field_path: "reviews.1.reviewItem.1.comment",
      field_name: "comment",
      locale: "all",
      parent_path: "reviews.1.reviewItem.1",
      field_type: "richText",
      value: {
        root: {
          type: "root",
          format: "",
          indent: 0,
          version: 1,
          children: [
            {
              type: "paragraph",
              format: "",
              indent: 0,
              version: 1,
              children: [
                {
                  mode: "normal",
                  text: "Some review text here...",
                  type: "text",
                  style: "",
                  detail: 0,
                  format: 0,
                  version: 1
                }
              ],
              direction: "ltr",
              textStyle: "",
              textFormat: 0
            }
          ],
          direction: "ltr"
        }
      }
    }
  ]
}