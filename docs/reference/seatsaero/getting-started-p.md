---
updatedAt: 2025-12-22T19:29:31.000Z
---

Fetch the complete documentation index at: https://developers.seats.aero/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Getting Started

This page will help you get started with the Seats.aero partner API.

The Seats.aero partner API allows you to instantly query redemption availability across all major airline alliances. The partner API can instantly quote pricing and availability for over 70,000 routes and perform live searches on any route across 20 different mileage programs.

The Seats.aero partner API can be used by Pro users for non-commercial purposes and only by written agreement for commercial use. Please contact <support@seats.aero> with a company email address and detailed use case information to learn about potential commercial options, although note many use cases are not supported.

## Authorization

You will need to send your API key in the `Partner-Authorization` header for all requests to the partner API.

### Commercial Users

You will receive an API key from the Seats.aero team.

### Pro Users

Seats.aero Pro users may be able to access the partner API for up to 1,000 API calls per day at no cost. Pro users can generate their personal API key via the API tab on their personal [settings page](https://seats.aero/settings). The partner API is governed by the [Seats.aero terms of use](https://seats.aero/terms), which prohibit commercial use of our APIs without written permission.

Not all Pro users can access the partner API key or retrieve an API key. We may limit access to the API by geographical location or for any reason in our sole discretion.

## Content Types

The Seats.aero API works entirely in JSON; all responses will be in JSON. For GET requests, you should send request parameters in query parameters. For POST requests, you should send a JSON body with an `application/json` content type.