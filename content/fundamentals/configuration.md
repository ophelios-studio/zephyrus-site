---
title: Configuration
order: 3
description: A preview of the Zephyrus configuration chapter.
---

# Configuration

Your environment, in one place.

Zephyrus uses YAML configuration with environment values and typed sections. This chapter will explain the settings available in the updated framework.

## A readable starting point

This visual specimen shows the style of configuration used in a Leaf site built on Zephyrus.

```yaml
application:
  environment: !env APP_ENV, dev
  debug: !env APP_DEBUG, true

render:
  engine: latte
  directory: app/Views
```

## What this chapter will cover

- Loading and organizing configuration
- Environment values and defaults
- Typed sections
- Development and production settings

> **Reference in preparation**
> The final configuration schema will follow the current core update.
