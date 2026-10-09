---
title: Routing
order: 1
description: A preview of attribute routing in the Zephyrus field guide.
---

# Routing

A direct path to your logic.

Zephyrus declares routes with PHP attributes on controller methods. This chapter is reserved for the updated routing reference.

## Routes in plain sight

The following example is a visual preview. It shows a URL parameter and the typed method that receives it.

```php
use Zephyrus\Http\Response;
use Zephyrus\Routing\Attribute\Get;

#[Get('/products/{id}')]
public function show(int $id): Response
{
    return Response::json(['id' => $id]);
}
```

## What this chapter will cover

- HTTP method attributes and controller discovery
- URL parameters and type coercion
- Route prefixes and named middleware
- Practical examples from the updated framework

> **Reference in preparation**
> Signatures, constraints and setup instructions will be finalized when the current core update is ready.

Continue to [HTTP](/fundamentals/http/) to preview the request and response chapter.
