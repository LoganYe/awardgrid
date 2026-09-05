---
updatedAt: 2025-04-23T04:17:49.000Z
---

Fetch the complete documentation index at: https://developers.seats.aero/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Get Trips

Retrieve flight-level information from an Availability object.

You should use this endpoint to get flight-level information from high-level availability objects that are returned in Get Availability and Cached Search.

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
    "/trips/{id}": {
      "get": {
        "summary": "Get Trips",
        "description": "Retrieve flight-level information from an Availability object.",
        "operationId": "get-trips",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "description": "The ID of the availability object.",
            "schema": {
              "type": "string"
            },
            "required": true
          },
          {
            "name": "include_filtered",
            "in": "query",
            "description": "Include expensive dynamically-priced results that may have been filtered out.",
            "schema": {
              "type": "boolean",
              "default": false
            }
          },
          {
            "name": "min_cabin_pct",
            "in": "query",
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
                    "value": "{\n    \"data\": [\n        {\n            \"ID\": \"2S8Cm9dHORWWKpoCkxfRkZa0e5l\",\n            \"RouteID\": \"2B9HOBW9EOvJQDTQqxc3UKEhhur\",\n            \"AvailabilityID\": \"2PPrELk9WcfJaNREWEPXypvhXAD\",\n            \"AvailabilitySegments\": [\n                {\n                    \"ID\": \"2S8CmA8bXa9KHaxZfUtihUzRTPd\",\n                    \"RouteID\": \"2B9HOBW9EOvJQDTQqxc3UKEhhur\",\n                    \"AvailabilityID\": \"2PPrELk9WcfJaNREWEPXypvhXAD\",\n                    \"AvailabilityTripID\": \"2S8Cm9dHORWWKpoCkxfRkZa0e5l\",\n                    \"FlightNumber\": \"CM326\",\n                    \"Distance\": 966,\n                    \"FareClass\": \"I\",\n                    \"AircraftName\": \"739\",\n                    \"AircraftCode\": \"739\",\n                    \"OriginAirport\": \"CUN\",\n                    \"DestinationAirport\": \"PTY\",\n                    \"DepartsAt\": \"2024-05-01T13:52:00Z\",\n                    \"ArrivesAt\": \"2024-05-01T16:31:00Z\",\n                    \"CreatedAt\": \"2023-07-05T01:02:57.782804Z\",\n                    \"UpdatedAt\": \"2023-07-08T07:12:25.266914Z\",\n                    \"Source\": \"lifemiles\",\n                    \"Order\": 0\n                },\n                {\n                    \"ID\": \"2S8CmEryWzLYnioVN6fJ2Ue5Lg8\",\n                    \"RouteID\": \"2B9HOBW9EOvJQDTQqxc3UKEhhur\",\n                    \"AvailabilityID\": \"2PPrELk9WcfJaNREWEPXypvhXAD\",\n                    \"AvailabilityTripID\": \"2S8Cm9dHORWWKpoCkxfRkZa0e5l\",\n                    \"FlightNumber\": \"TK800\",\n                    \"Distance\": 6739,\n                    \"FareClass\": \"I\",\n                    \"AircraftName\": \"77W\",\n                    \"AircraftCode\": \"77W\",\n                    \"OriginAirport\": \"PTY\",\n                    \"DestinationAirport\": \"IST\",\n                    \"DepartsAt\": \"2024-05-01T20:05:00Z\",\n                    \"ArrivesAt\": \"2024-05-02T16:45:00Z\",\n                    \"CreatedAt\": \"2023-07-05T01:02:57.782804Z\",\n                    \"UpdatedAt\": \"2023-07-08T07:12:25.266914Z\",\n                    \"Source\": \"lifemiles\",\n                    \"Order\": 1\n                }\n            ],\n            \"TotalDuration\": 1133,\n            \"Stops\": 1,\n            \"Carriers\": \"CM, TK\",\n            \"RemainingSeats\": 9,\n            \"MileageCost\": 70000,\n            \"TotalTaxes\": 1290,\n            \"TaxesCurrency\": \"\",\n            \"TaxesCurrencySymbol\": \"\",\n            \"AllianceCost\": 87944,\n            \"FlightNumbers\": \"CM326, TK800\",\n            \"DepartsAt\": \"2024-05-01T13:52:00Z\",\n            \"Cabin\": \"business\",\n            \"ArrivesAt\": \"2024-05-02T16:45:00Z\",\n            \"CreatedAt\": \"2023-07-05T01:02:57.782804Z\",\n            \"UpdatedAt\": \"2023-07-08T07:12:25.266914Z\",\n            \"Source\": \"lifemiles\"\n        },\n        {\n            \"ID\": \"2PpmopJhuy4EHjBDqz0anF23NZG\",\n            \"RouteID\": \"2B9HOBW9EOvJQDTQqxc3UKEhhur\",\n            \"AvailabilityID\": \"2PPrELk9WcfJaNREWEPXypvhXAD\",\n            \"AvailabilitySegments\": [\n                {\n                    \"ID\": \"2PpmoqoW1gd8hxW4bbdQFE9n8jj\",\n                    \"RouteID\": \"2B9HOBW9EOvJQDTQqxc3UKEhhur\",\n                    \"AvailabilityID\": \"2PPrELk9WcfJaNREWEPXypvhXAD\",\n                    \"AvailabilityTripID\": \"2PpmopJhuy4EHjBDqz0anF23NZG\",\n                    \"FlightNumber\": \"TK184\",\n                    \"Distance\": 6503,\n                    \"FareClass\": \"I\",\n                    \"AircraftName\": \"77W\",\n                    \"AircraftCode\": \"77W\",\n                    \"OriginAirport\": \"CUN\",\n                    \"DestinationAirport\": \"IST\",\n                    \"DepartsAt\": \"2024-05-01T14:00:00Z\",\n                    \"ArrivesAt\": \"2024-05-02T10:10:00Z\",\n                    \"CreatedAt\": \"2023-05-15T14:56:14.168038Z\",\n                    \"UpdatedAt\": \"2023-07-08T07:12:25.266914Z\",\n                    \"Source\": \"lifemiles\",\n                    \"Order\": 0\n                }\n            ],\n            \"TotalDuration\": 730,\n            \"Stops\": 0,\n            \"Carriers\": \"TK\",\n            \"RemainingSeats\": 4,\n            \"MileageCost\": 70000,\n            \"TotalTaxes\": 4174,\n            \"TaxesCurrency\": \"\",\n            \"TaxesCurrencySymbol\": \"\",\n            \"AllianceCost\": 77239,\n            \"FlightNumbers\": \"TK184\",\n            \"DepartsAt\": \"2024-05-01T14:00:00Z\",\n            \"Cabin\": \"business\",\n            \"ArrivesAt\": \"2024-05-02T10:10:00Z\",\n            \"CreatedAt\": \"2023-05-15T14:56:14.168038Z\",\n            \"UpdatedAt\": \"2023-07-08T07:12:25.266914Z\",\n            \"Source\": \"lifemiles\"\n        },\n        {\n            \"ID\": \"2Rz56y1pd82svLce0X9LEOr3btm\",\n            \"RouteID\": \"2B9HOBW9EOvJQDTQqxc3UKEhhur\",\n            \"AvailabilityID\": \"2PPrELk9WcfJaNREWEPXypvhXAD\",\n            \"AvailabilitySegments\": [\n                {\n                    \"ID\": \"2Rz5716GezvEXsK8lgXC5r1ikLb\",\n                    \"RouteID\": \"2B9HOBW9EOvJQDTQqxc3UKEhhur\",\n                    \"AvailabilityID\": \"2PPrELk9WcfJaNREWEPXypvhXAD\",\n                    \"AvailabilityTripID\": \"2Rz56y1pd82svLce0X9LEOr3btm\",\n                    \"FlightNumber\": \"CM262\",\n                    \"Distance\": 966,\n                    \"FareClass\": \"I\",\n                    \"AircraftName\": \"738\",\n                    \"AircraftCode\": \"738\",\n                    \"OriginAirport\": \"CUN\",\n                    \"DestinationAirport\": \"PTY\",\n                    \"DepartsAt\": \"2024-05-01T11:52:00Z\",\n                    \"ArrivesAt\": \"2024-05-01T14:35:00Z\",\n                    \"CreatedAt\": \"2023-07-01T19:31:37.227793Z\",\n                    \"UpdatedAt\": \"2023-07-08T07:12:25.266914Z\",\n                    \"Source\": \"lifemiles\",\n                    \"Order\": 0\n                },\n                {\n                    \"ID\": \"2Rz56wgdGerLguXFBcJ1Pvz1lNv\",\n                    \"RouteID\": \"2B9HOBW9EOvJQDTQqxc3UKEhhur\",\n                    \"AvailabilityID\": \"2PPrELk9WcfJaNREWEPXypvhXAD\",\n                    \"AvailabilityTripID\": \"2Rz56y1pd82svLce0X9LEOr3btm\",\n                    \"FlightNumber\": \"TK800\",\n                    \"Distance\": 6739,\n                    \"FareClass\": \"I\",\n                    \"AircraftName\": \"77W\",\n                    \"AircraftCode\": \"77W\",\n                    \"OriginAirport\": \"PTY\",\n                    \"DestinationAirport\": \"IST\",\n                    \"DepartsAt\": \"2024-05-01T20:05:00Z\",\n                    \"ArrivesAt\": \"2024-05-02T16:45:00Z\",\n                    \"CreatedAt\": \"2023-07-01T19:31:37.227793Z\",\n                    \"UpdatedAt\": \"2023-07-08T07:12:25.266914Z\",\n                    \"Source\": \"lifemiles\",\n                    \"Order\": 1\n                }\n            ],\n            \"TotalDuration\": 1253,\n            \"Stops\": 1,\n            \"Carriers\": \"CM, TK\",\n            \"RemainingSeats\": 9,\n            \"MileageCost\": 70000,\n            \"TotalTaxes\": 1290,\n            \"TaxesCurrency\": \"\",\n            \"TaxesCurrencySymbol\": \"\",\n            \"AllianceCost\": 87944,\n            \"FlightNumbers\": \"CM262, TK800\",\n            \"DepartsAt\": \"2024-05-01T11:52:00Z\",\n            \"Cabin\": \"business\",\n            \"ArrivesAt\": \"2024-05-02T16:45:00Z\",\n            \"CreatedAt\": \"2023-07-01T19:31:37.227793Z\",\n            \"UpdatedAt\": \"2023-07-08T07:12:25.266914Z\",\n            \"Source\": \"lifemiles\"\n        }\n    ],\n    \"origin_coordinates\": {\n        \"Lat\": 21.036500930800003,\n        \"Lon\": -86.8770980835\n    },\n    \"destination_coordinates\": {\n        \"Lat\": 40.9768981934,\n        \"Lon\": 28.814599990799998\n    },\n    \"booking_links\": [\n        {\n            \"label\": \"Book via Avianca LifeMiles\",\n            \"link\": \"https://www.lifemiles.com/fly/find\",\n            \"primary\": true\n        },\n        {\n            \"label\": \"Book via Air Canada Aeroplan\",\n            \"link\": \"https://www.aircanada.com/aeroplan/redeem/availability/outbound?org0=CUN&dest0=IST&departureDate0=2024-05-01&lang=en-CA&tripType=O&ADT=1&YTH=0&CHD=0&INF=0&INS=0&marketCode=INT\",\n            \"primary\": false\n        },\n        {\n            \"label\": \"Book via United MileagePlus\",\n            \"link\": \"https://www.united.com/en/us/fsr/choose-flights?f=CUN&t=IST&d=2024-05-01&sc=7&st=bestmatches&cbm=-1&cbm2=-1&ft=0&cp=0&tt=1&at=1&rm=1&act=0&px=1&taxng=1&clm=7&tqp=A\",\n            \"primary\": false\n        }\n    ]\n}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "ID": {
                            "type": "string",
                            "example": "2S8Cm9dHORWWKpoCkxfRkZa0e5l"
                          },
                          "RouteID": {
                            "type": "string",
                            "example": "2B9HOBW9EOvJQDTQqxc3UKEhhur"
                          },
                          "AvailabilityID": {
                            "type": "string",
                            "example": "2PPrELk9WcfJaNREWEPXypvhXAD"
                          },
                          "AvailabilitySegments": {
                            "type": "array",
                            "items": {
                              "type": "object",
                              "properties": {
                                "ID": {
                                  "type": "string",
                                  "example": "2S8CmA8bXa9KHaxZfUtihUzRTPd"
                                },
                                "RouteID": {
                                  "type": "string",
                                  "example": "2B9HOBW9EOvJQDTQqxc3UKEhhur"
                                },
                                "AvailabilityID": {
                                  "type": "string",
                                  "example": "2PPrELk9WcfJaNREWEPXypvhXAD"
                                },
                                "AvailabilityTripID": {
                                  "type": "string",
                                  "example": "2S8Cm9dHORWWKpoCkxfRkZa0e5l"
                                },
                                "FlightNumber": {
                                  "type": "string",
                                  "example": "CM326"
                                },
                                "Distance": {
                                  "type": "integer",
                                  "example": 966,
                                  "default": 0
                                },
                                "FareClass": {
                                  "type": "string",
                                  "example": "I"
                                },
                                "AircraftName": {
                                  "type": "string",
                                  "example": "739"
                                },
                                "AircraftCode": {
                                  "type": "string",
                                  "example": "739"
                                },
                                "OriginAirport": {
                                  "type": "string",
                                  "example": "CUN"
                                },
                                "DestinationAirport": {
                                  "type": "string",
                                  "example": "PTY"
                                },
                                "DepartsAt": {
                                  "type": "string",
                                  "example": "2024-05-01T13:52:00Z"
                                },
                                "ArrivesAt": {
                                  "type": "string",
                                  "example": "2024-05-01T16:31:00Z"
                                },
                                "CreatedAt": {
                                  "type": "string",
                                  "example": "2023-07-05T01:02:57.782804Z"
                                },
                                "UpdatedAt": {
                                  "type": "string",
                                  "example": "2023-07-08T07:12:25.266914Z"
                                },
                                "Source": {
                                  "type": "string",
                                  "example": "lifemiles"
                                },
                                "Order": {
                                  "type": "integer",
                                  "example": 0,
                                  "default": 0
                                }
                              }
                            }
                          },
                          "TotalDuration": {
                            "type": "integer",
                            "example": 1133,
                            "default": 0
                          },
                          "Stops": {
                            "type": "integer",
                            "example": 1,
                            "default": 0
                          },
                          "Carriers": {
                            "type": "string",
                            "example": "CM, TK"
                          },
                          "RemainingSeats": {
                            "type": "integer",
                            "example": 9,
                            "default": 0
                          },
                          "MileageCost": {
                            "type": "integer",
                            "example": 70000,
                            "default": 0
                          },
                          "TotalTaxes": {
                            "type": "integer",
                            "example": 1290,
                            "default": 0
                          },
                          "TaxesCurrency": {
                            "type": "string",
                            "example": ""
                          },
                          "TaxesCurrencySymbol": {
                            "type": "string",
                            "example": ""
                          },
                          "AllianceCost": {
                            "type": "integer",
                            "example": 87944,
                            "default": 0
                          },
                          "FlightNumbers": {
                            "type": "string",
                            "example": "CM326, TK800"
                          },
                          "DepartsAt": {
                            "type": "string",
                            "example": "2024-05-01T13:52:00Z"
                          },
                          "Cabin": {
                            "type": "string",
                            "example": "business"
                          },
                          "ArrivesAt": {
                            "type": "string",
                            "example": "2024-05-02T16:45:00Z"
                          },
                          "CreatedAt": {
                            "type": "string",
                            "example": "2023-07-05T01:02:57.782804Z"
                          },
                          "UpdatedAt": {
                            "type": "string",
                            "example": "2023-07-08T07:12:25.266914Z"
                          },
                          "Source": {
                            "type": "string",
                            "example": "lifemiles"
                          },
                          "MixedCabinPct": {
                            "type": "integer",
                            "format": "int32",
                            "minimum": 1,
                            "maximum": 100,
                            "description": "Percentage of the itinerary's distance flown below the reported Cabin. Omitted when no distance is flown below that cabin.",
                            "example": 25
                          }
                        }
                      }
                    },
                    "origin_coordinates": {
                      "type": "object",
                      "properties": {
                        "Lat": {
                          "type": "number",
                          "example": 21.036500930800003,
                          "default": 0
                        },
                        "Lon": {
                          "type": "number",
                          "example": -86.8770980835,
                          "default": 0
                        }
                      }
                    },
                    "destination_coordinates": {
                      "type": "object",
                      "properties": {
                        "Lat": {
                          "type": "number",
                          "example": 40.9768981934,
                          "default": 0
                        },
                        "Lon": {
                          "type": "number",
                          "example": 28.814599990799998,
                          "default": 0
                        }
                      }
                    },
                    "booking_links": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "label": {
                            "type": "string",
                            "example": "Book via Avianca LifeMiles"
                          },
                          "link": {
                            "type": "string",
                            "example": "https://www.lifemiles.com/fly/find"
                          },
                          "primary": {
                            "type": "boolean",
                            "example": true,
                            "default": true
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "404": {
            "description": "404",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": ""
                  }
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