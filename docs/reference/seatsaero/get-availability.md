---
updatedAt: 2025-04-23T04:17:48.000Z
---

Fetch the complete documentation index at: https://developers.seats.aero/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Bulk Availability

Retrieve a large amount of availability objects from one specific mileage program.

The Bulk Availability endpoint allows you to retrieve many results from one specific mileage program. Similar to Cached Search, this endpoint returns an array of summary availability objects. You should use this endpoint for broad availability searches across regions. If you have specific airports and dates in mind, you should use Cached Search instead.

# OpenAPI definition

```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "partner-api",
    "version": "1.0"
  },
  "servers": [
    {
      "url": "https://seats.aero/partnerapi/"
    }
  ],
  "components": {
    "securitySchemes": {
      "sec0": {
        "type": "apiKey",
        "in": "header",
        "name": "Partner-Authorization"
      }
    }
  },
  "security": [
    {
      "sec0": []
    }
  ],
  "paths": {
    "/availability": {
      "get": {
        "summary": "Bulk Availability",
        "description": "Retrieve a large amount of availability objects from one specific mileage program.",
        "operationId": "get-availability",
        "parameters": [
          {
            "name": "source",
            "in": "query",
            "description": "The mileage program to retrieve availability from.",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "cabin",
            "in": "query",
            "description": "Only returns results with this cabin available. Must be one of: [economy, premium, business, first]",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "start_date",
            "in": "query",
            "description": "Only returns results between start_date and end_date when specified.",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "end_date",
            "in": "query",
            "description": "Only returns results between start_date and end_date when specified.",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "origin_region",
            "in": "query",
            "description": "Only returns results originating in this region when specified. Must be one of: [North America, South America, Africa, Asia, Europe, Oceania]",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "destination_region",
            "in": "query",
            "description": "Only returns results arriving in this region when specified. Must be one of: [North America, South America, Africa, Asia, Europe, Oceania]",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "take",
            "in": "query",
            "description": "How many results to return. Must be >=10 and <= 1000 if specified, otherwise 500.",
            "schema": {
              "type": "integer",
              "format": "int32",
              "default": 500
            }
          },
          {
            "name": "cursor",
            "in": "query",
            "description": "Cursor you retrieved from a previous availability response.",
            "schema": {
              "type": "integer",
              "format": "int32"
            }
          },
          {
            "name": "skip",
            "in": "query",
            "description": "How many results to skip that you have already retrieved. Use this with the cursor to paginate responses.",
            "schema": {
              "type": "integer",
              "format": "int32",
              "default": 0
            }
          },
          {
            "in": "query",
            "name": "include_filtered",
            "schema": {
              "type": "boolean",
              "default": "false"
            },
            "description": "Return results that only have raw (filtered) results. Enable this when using the raw fields to prevent dynamic price filtering."
          },
          {
            "in": "query",
            "name": "min_cabin_pct",
            "description": "Minimum percentage of each itinerary's distance that must be flown in its reported Cabin or a higher cabin. Must be a whole number from 0 to 100. For example, 75 permits up to 25% of the journey in a lower cabin. Omit this parameter or set it to 100 to exclude itineraries with any distance below the reported Cabin.",
            "schema": {
              "type": "integer",
              "format": "int32",
              "minimum": 0,
              "maximum": 100,
              "default": 100
            }
          }
        ],
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {}
                }
              }
            }
          },
          "400": {
            "description": "400",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {}
                }
              }
            }
          }
        },
        "deprecated": false
      }
    }
  },
  "x-readme": {
    "headers": [],
    "explorer-enabled": true,
    "proxy-enabled": true
  },
  "x-readme-fauxas": true
}
```