---
updatedAt: 2025-04-23T04:17:50.000Z
---

Fetch the complete documentation index at: https://developers.seats.aero/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Get Routes

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
    "/routes": {
      "get": {
        "summary": "Get Routes",
        "description": "",
        "operationId": "get-routes-1",
        "parameters": [
          {
            "name": "source",
            "in": "query",
            "required": true,
            "schema": {
              "type": "string"
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
                    "value": "[\n    {\n        \"ID\": \"2QghXwB1QjGRYbTBKFBkSDD1Wcs\",\n        \"OriginAirport\": \"TPE\",\n        \"OriginRegion\": \"Asia\",\n        \"DestinationAirport\": \"PNH\",\n        \"DestinationRegion\": \"Asia\",\n        \"NumDaysOut\": 60,\n        \"Distance\": 1423,\n        \"Source\": \"aeroplan\"\n    }\n]"
                  }
                },
                "schema": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "ID": {
                        "type": "string",
                        "example": "2QghXwB1QjGRYbTBKFBkSDD1Wcs"
                      },
                      "OriginAirport": {
                        "type": "string",
                        "example": "TPE"
                      },
                      "OriginRegion": {
                        "type": "string",
                        "example": "Asia"
                      },
                      "DestinationAirport": {
                        "type": "string",
                        "example": "PNH"
                      },
                      "DestinationRegion": {
                        "type": "string",
                        "example": "Asia"
                      },
                      "NumDaysOut": {
                        "type": "integer",
                        "example": 60,
                        "default": 0
                      },
                      "Distance": {
                        "type": "integer",
                        "example": 1423,
                        "default": 0
                      },
                      "Source": {
                        "type": "string",
                        "example": "aeroplan"
                      }
                    }
                  }
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