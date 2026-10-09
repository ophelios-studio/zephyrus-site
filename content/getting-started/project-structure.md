---
title: Project structure
order: 2
description: A preview of the Zephyrus project structure chapter.
---

# Project structure

A home for each part of your application.

This chapter will describe the application template after the current framework update. The outline below is a visual specimen for the field guide.

## The application at a glance

Controllers, views and configuration each have a visible place. The final guide will walk through the template, explain how a request enters the application and show where your own code belongs.

```text
app/
  Controllers/     Routes and request handlers
  Models/          Your application logic
  Views/           Latte templates
public/            The web entry point and assets
config.yml         Application configuration
```

> **Chapter in preparation**
> The final directory map and commands will be checked against the updated application template.

## A path through the application

1. A request enters the application.
2. The router finds a matching controller method.
3. Middleware handles the applicable boundaries.
4. The controller returns a response.

The [Routing](/fundamentals/routing/) chapter will look more closely at how URLs reach your code.
