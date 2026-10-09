---
title: Introduction
order: 1
description: A first look at the Zephyrus field guide. A clear place to begin.
---

# Introduction

A clear place to begin.

Zephyrus is a cohesive PHP framework that brings attribute routing, immutable HTTP objects, typed configuration and security middleware into one foundation.

This field guide is taking shape alongside the next framework update. For now, it offers a first look at the reading experience and the subjects it will cover.

## A considered foundation

The idea is straightforward: make the path through an application easy to follow. Keep a route close to its controller, make the response explicit and put configuration somewhere you can see it.

> **A note on this preview**
> Code examples illustrate the design of the framework. The full reference and setup instructions will follow the current core update.

## What belongs in the core

The guide follows the parts of a request, from its entry point to its response.

| Subject | What we'll explore |
| --- | --- |
| [Routing](/fundamentals/routing/) | Attributes, controllers and typed parameters |
| [HTTP](/fundamentals/http/) | Requests, responses and immutability |
| [Configuration](/fundamentals/configuration/) | YAML, environment values and typed sections |
| [Localization](/fundamentals/localization/) | JSON catalogs, parameters and locale fallback |
| [Data access](/fundamentals/data/) | Explicit SQL, Brokers and Entity objects |
| [Security](/fundamentals/security/) | Middleware and input validation |

## A small first example

A route declares its path directly on the method that handles it. This illustrative example returns a JSON response.

```php
use Zephyrus\Http\Response;
use Zephyrus\Routing\Attribute\Get;

#[Get('/hello')]
public function hello(): Response
{
    return Response::json(['message' => 'Hello, world.']);
}
```

The URL, method and response are all visible together. The routing chapter will expand on the conventions after the update.

## Reading the field guide

Use the chapters on the left to explore a subject. The outline on the right follows the current page. Search the guide with `⌘ K` on macOS or `Ctrl K` elsewhere.

The next stop is [Project structure](/getting-started/project-structure/), a preview of how the guide will explain the parts of a Zephyrus application.
