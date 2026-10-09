---
title: Localization
order: 4
description: JSON catalogs, nested keys and translation parameters in Zephyrus.
---

# Localization

Another language. A JSON file.

The locale loader merges JSON files from a locale directory. Nested messages can be reached with dot notation, such as `demo.greeting`.

## Readable messages

```json
{
  "demo": {
    "greeting": "Hello, {name}",
    "items": "{count} {count|plural:item:items}"
  }
}
```

```php
localize('demo.greeting', ['name' => 'Sam']);
localize('demo.items', ['count' => 3]);
```

Parameters are inserted into the message. Formatting pipes can change case, format a number or choose a singular or plural form.

## Locale fallback

The translator first looks in the requested regional locale. For `fr-CA`, it then tries `fr`, followed by the configured default locale.

## What comes next

> **Reference in preparation**
> This preview presents mechanisms observed in the core. Initialization, caching options and complete integration examples will follow the update.
