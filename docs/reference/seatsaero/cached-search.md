---
updatedAt: 2025-04-23T04:17:48.000Z
---

Fetch the complete documentation index at: https://developers.seats.aero/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Cached Search

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
    "/search": {
      "get": {
        "summary": "Cached Search",
        "description": "",
        "operationId": "cached-search",
        "parameters": [
          {
            "name": "origin_airport",
            "in": "query",
            "description": "A list of origin airports. Comma-delimited if multiple, such as \"SFO,LAX\".",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "destination_airport",
            "in": "query",
            "description": "A list of destination airports. Comma-delimited if multiple, such as \"FRA,LHR\".",
            "required": true,
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "start_date",
            "in": "query",
            "description": "Results must depart between start_date and end_date when specified, in YYYY-MM-DD format.",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "end_date",
            "in": "query",
            "description": "Results must depart between start_date and end_date when specified, in YYYY-MM-DD format.",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "cursor",
            "in": "query",
            "description": "A cursor you obtained from a previous search call.",
            "schema": {
              "type": "integer",
              "format": "int32"
            }
          },
          {
            "name": "take",
            "in": "query",
            "description": "Maximum amount of results to respond with. Must be >= 10 and <= 1000.",
            "schema": {
              "type": "integer",
              "format": "int32",
              "default": 500
            }
          },
          {
            "name": "order_by",
            "in": "query",
            "description": "By default, results are ordered by departure date and then by available cabins, with available premium cabins ranked above results without them available. You can alternatively specify lowest_mileage in this parameter to return results with the cheapest prices first.",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "skip",
            "in": "query",
            "description": "How many results to skip.",
            "schema": {
              "type": "integer",
              "format": "int32"
            }
          },
          {
            "name": "include_trips",
            "in": "query",
            "description": "Include trip-level details in the API response. This may degrade response time and sizing.",
            "schema": {
              "type": "boolean",
              "default": false
            }
          },
          {
            "name": "only_direct_flights",
            "in": "query",
            "description": "Only return results that have a direct flight available. Respects the cabin parameter if provided.",
            "schema": {
              "type": "boolean",
              "default": false
            }
          },
          {
            "name": "carriers",
            "in": "query",
            "description": "Only return results involving these comma-separated carriers (i.e. \"DL,AA\"). Respects the cabin parameter if provided.",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "include_filtered",
            "in": "query",
            "description": "Return results that only have raw (filtered) results. Enable this when using the raw fields to prevent dynamic price filtering.",
            "schema": {
              "type": "boolean",
              "default": false
            }
          },
          {
            "in": "query",
            "name": "sources",
            "schema": {
              "type": "string"
            },
            "description": "A list of mileage programs to filter by. Comma-delimited if multiple, such as \"aeroplan,united\"."
          },
          {
            "in": "query",
            "name": "minify_trips",
            "schema": {
              "type": "boolean"
            },
            "description": "When include_trips and minify_trips are both enabled, returns a reduced amount of fields in each trip to improve performance."
          },
          {
            "in": "query",
            "name": "cabins",
            "schema": {
              "type": "string"
            },
            "description": "Results must have these cabins available when specified. Comma-delimited if multiple, such as \"economy,business\". Must not be provided if \"cabin\" was provided."
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
                    "value": "{\n    \"data\": [\n        {\n            \"ID\": \"2QSaUXJ0ZuSVqgrRWqkSlXhnVbS\",\n            \"RouteID\": \"2HmSwbzAS9SnEdtIsf3nkjozpX1\",\n            \"Route\": {\n                \"ID\": \"2HmSwbzAS9SnEdtIsf3nkjozpX1\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"JFK\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 75,\n                \"Distance\": 2582,\n                \"Source\": \"american\"\n            },\n            \"Date\": \"2023-08-11\",\n            \"ParsedDate\": \"2023-08-11T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": true,\n            \"YMileageCost\": \"12500\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"33000\",\n            \"FMileageCost\": \"33000\",\n            \"YRemainingSeats\": 0,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 0,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AA, B6\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"AA, B6\",\n            \"FAirlines\": \"AA\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": true,\n            \"Source\": \"american\",\n            \"CreatedAt\": \"2023-05-29T08:37:32.218426Z\",\n            \"UpdatedAt\": \"2023-07-10T13:52:23.343425Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2R8aFIAHrQJPURIa6OCIVWQOybR\",\n            \"RouteID\": \"2Qd8i1CesLLdNQGrQVWTT4A0b1C\",\n            \"Route\": {\n                \"ID\": \"2Qd8i1CesLLdNQGrQVWTT4A0b1C\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"JFK\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 2582,\n                \"Source\": \"alaska\"\n            },\n            \"Date\": \"2023-08-11\",\n            \"ParsedDate\": \"2023-08-11T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": true,\n            \"YMileageCost\": \"20000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"45000\",\n            \"FMileageCost\": \"25000\",\n            \"YRemainingSeats\": 7,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 7,\n            \"FRemainingSeats\": 4,\n            \"YAirlines\": \"AS\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"AS\",\n            \"FAirlines\": \"AA, AS\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"alaska\",\n            \"CreatedAt\": \"2023-06-13T05:27:36.817909Z\",\n            \"UpdatedAt\": \"2023-07-10T16:47:02.394106Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2J79SuPtMDjpsEdhgdUgkTveJLF\",\n            \"RouteID\": \"2HmZc5mdC1PWSgwbFfZoW1G7VMp\",\n            \"Route\": {\n                \"ID\": \"2HmZc5mdC1PWSgwbFfZoW1G7VMp\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"LHR\",\n                \"DestinationRegion\": \"Europe\",\n                \"NumDaysOut\": 75,\n                \"Distance\": 5359,\n                \"Source\": \"american\"\n            },\n            \"Date\": \"2023-08-11\",\n            \"ParsedDate\": \"2023-08-11T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": true,\n            \"YMileageCost\": \"30000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"57500\",\n            \"FMileageCost\": \"106000\",\n            \"YRemainingSeats\": 0,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 0,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AA, BA\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"BA\",\n            \"FAirlines\": \"AA\",\n            \"YDirect\": false,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"american\",\n            \"CreatedAt\": \"2022-12-19T02:50:57.410473Z\",\n            \"UpdatedAt\": \"2023-07-10T14:10:48.976143Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2QeB5K3qSAYxSzOYLGsJhROrsVL\",\n            \"RouteID\": \"2Qd8htSo1HNEVkERlvIlyQg5fBO\",\n            \"Route\": {\n                \"ID\": \"2Qd8htSo1HNEVkERlvIlyQg5fBO\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"LHR\",\n                \"DestinationRegion\": \"Europe\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 5359,\n                \"Source\": \"alaska\"\n            },\n            \"Date\": \"2023-08-11\",\n            \"ParsedDate\": \"2023-08-11T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"30000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"65000\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 6,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 9,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AA, AS, EI\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"BA\",\n            \"FAirlines\": \"\",\n            \"YDirect\": false,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"alaska\",\n            \"CreatedAt\": \"2023-06-02T11:06:21.743548Z\",\n            \"UpdatedAt\": \"2023-07-10T13:31:42.767942Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2R8aBO724gUMxnAhnoX7iLv28a5\",\n            \"RouteID\": \"2Qd8hyjEypv1Fik69IVdBg0WKIK\",\n            \"Route\": {\n                \"ID\": \"2Qd8hyjEypv1Fik69IVdBg0WKIK\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"EWR\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 2561,\n                \"Source\": \"alaska\"\n            },\n            \"Date\": \"2023-08-11\",\n            \"ParsedDate\": \"2023-08-11T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"20000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"55000\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 7,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 7,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AS\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"AS\",\n            \"FAirlines\": \"\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"alaska\",\n            \"CreatedAt\": \"2023-06-13T05:27:05.216042Z\",\n            \"UpdatedAt\": \"2023-07-10T16:47:01.820717Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2R91qrbdQaUWMdtFLSsPBrKWf8d\",\n            \"RouteID\": \"2IZU4neIqrVuxLopVliJC1cgtVI\",\n            \"Route\": {\n                \"ID\": \"2IZU4neIqrVuxLopVliJC1cgtVI\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"JFK\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 2582,\n                \"Source\": \"delta\"\n            },\n            \"Date\": \"2023-08-11\",\n            \"ParsedDate\": \"2023-08-11T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"17500\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"90000\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 9,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 9,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"DL\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"DL\",\n            \"FAirlines\": \"\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"delta\",\n            \"CreatedAt\": \"2023-06-13T09:14:36.817041Z\",\n            \"UpdatedAt\": \"2023-07-10T16:46:59.476767Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2IzwuV72tpT4BPYPNtLC7bRv7oM\",\n            \"RouteID\": \"2EQanxEfWCL0fcNKmQpbE6Wcg9h\",\n            \"Route\": {\n                \"ID\": \"2EQanxEfWCL0fcNKmQpbE6Wcg9h\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"LHR\",\n                \"DestinationRegion\": \"Europe\",\n                \"NumDaysOut\": 120,\n                \"Distance\": 5359,\n                \"Source\": \"virginatlantic\"\n            },\n            \"Date\": \"2023-08-11\",\n            \"ParsedDate\": \"2023-08-11T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": true,\n            \"JAvailable\": true,\n            \"FAvailable\": null,\n            \"YMileageCost\": \"17500\",\n            \"WMileageCost\": \"26200\",\n            \"JMileageCost\": \"54200\",\n            \"FMileageCost\": null,\n            \"YRemainingSeats\": 9,\n            \"WRemainingSeats\": 9,\n            \"JRemainingSeats\": 3,\n            \"FRemainingSeats\": null,\n            \"YAirlines\": \"VS\",\n            \"WAirlines\": \"VS\",\n            \"JAirlines\": \"VS\",\n            \"FAirlines\": null,\n            \"YDirect\": true,\n            \"WDirect\": true,\n            \"JDirect\": true,\n            \"FDirect\": null,\n            \"Source\": \"virginatlantic\",\n            \"CreatedAt\": \"2022-12-16T13:39:02.251472Z\",\n            \"UpdatedAt\": \"2023-07-10T13:35:32.557504Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2QUVw0M2e962qx9I8rfbnH8z6Z5\",\n            \"RouteID\": \"2HmSwbzAS9SnEdtIsf3nkjozpX1\",\n            \"Route\": {\n                \"ID\": \"2HmSwbzAS9SnEdtIsf3nkjozpX1\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"JFK\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 75,\n                \"Distance\": 2582,\n                \"Source\": \"american\"\n            },\n            \"Date\": \"2023-08-12\",\n            \"ParsedDate\": \"2023-08-12T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": true,\n            \"YMileageCost\": \"12500\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"33000\",\n            \"FMileageCost\": \"33000\",\n            \"YRemainingSeats\": 0,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 0,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AA, AS, B6\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"AA, B6\",\n            \"FAirlines\": \"AA\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": true,\n            \"Source\": \"american\",\n            \"CreatedAt\": \"2023-05-30T00:59:41.813766Z\",\n            \"UpdatedAt\": \"2023-07-10T13:51:53.771505Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2J7Anwrw9r5XeMY4yRSMXtZ3wbj\",\n            \"RouteID\": \"2HmZc5mdC1PWSgwbFfZoW1G7VMp\",\n            \"Route\": {\n                \"ID\": \"2HmZc5mdC1PWSgwbFfZoW1G7VMp\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"LHR\",\n                \"DestinationRegion\": \"Europe\",\n                \"NumDaysOut\": 75,\n                \"Distance\": 5359,\n                \"Source\": \"american\"\n            },\n            \"Date\": \"2023-08-12\",\n            \"ParsedDate\": \"2023-08-12T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": true,\n            \"YMileageCost\": \"30000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"57500\",\n            \"FMileageCost\": \"97000\",\n            \"YRemainingSeats\": 0,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 0,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AA, AS, BA\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"BA\",\n            \"FAirlines\": \"AA\",\n            \"YDirect\": false,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"american\",\n            \"CreatedAt\": \"2022-12-19T03:01:57.260038Z\",\n            \"UpdatedAt\": \"2023-07-10T14:10:34.030944Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2QhRQpP6ZjQO1nUeNm5TXVMmEWd\",\n            \"RouteID\": \"2Qd8htSo1HNEVkERlvIlyQg5fBO\",\n            \"Route\": {\n                \"ID\": \"2Qd8htSo1HNEVkERlvIlyQg5fBO\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"LHR\",\n                \"DestinationRegion\": \"Europe\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 5359,\n                \"Source\": \"alaska\"\n            },\n            \"Date\": \"2023-08-12\",\n            \"ParsedDate\": \"2023-08-12T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"30000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"65000\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 7,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 2,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AA, AS, BA, EI\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"BA\",\n            \"FAirlines\": \"\",\n            \"YDirect\": false,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"alaska\",\n            \"CreatedAt\": \"2023-06-03T14:50:12.142087Z\",\n            \"UpdatedAt\": \"2023-07-10T13:31:45.280844Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2RB018lcNKPazUO5ECFsoyGot3s\",\n            \"RouteID\": \"2Qd8i1CesLLdNQGrQVWTT4A0b1C\",\n            \"Route\": {\n                \"ID\": \"2Qd8i1CesLLdNQGrQVWTT4A0b1C\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"JFK\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 2582,\n                \"Source\": \"alaska\"\n            },\n            \"Date\": \"2023-08-12\",\n            \"ParsedDate\": \"2023-08-12T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"12500\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"45000\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 7,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 7,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AA, AS\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"AS\",\n            \"FAirlines\": \"\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"alaska\",\n            \"CreatedAt\": \"2023-06-14T01:59:08.705962Z\",\n            \"UpdatedAt\": \"2023-07-10T16:47:06.865483Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2RD6oUAtGbd2a3c0i8FfDSNl1kj\",\n            \"RouteID\": \"2IZU4neIqrVuxLopVliJC1cgtVI\",\n            \"Route\": {\n                \"ID\": \"2IZU4neIqrVuxLopVliJC1cgtVI\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"JFK\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 2582,\n                \"Source\": \"delta\"\n            },\n            \"Date\": \"2023-08-12\",\n            \"ParsedDate\": \"2023-08-12T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"20000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"90000\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 9,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 9,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"DL\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"DL\",\n            \"FAirlines\": \"\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"delta\",\n            \"CreatedAt\": \"2023-06-14T19:54:39.838369Z\",\n            \"UpdatedAt\": \"2023-07-10T16:47:00.411019Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2RAzzO3PT6oA16jMvhaPK03cAWX\",\n            \"RouteID\": \"2Qd8hyjEypv1Fik69IVdBg0WKIK\",\n            \"Route\": {\n                \"ID\": \"2Qd8hyjEypv1Fik69IVdBg0WKIK\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"EWR\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 2561,\n                \"Source\": \"alaska\"\n            },\n            \"Date\": \"2023-08-12\",\n            \"ParsedDate\": \"2023-08-12T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"20000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"45000\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 7,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 7,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AS\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"AS\",\n            \"FAirlines\": \"\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"alaska\",\n            \"CreatedAt\": \"2023-06-14T01:58:54.857144Z\",\n            \"UpdatedAt\": \"2023-07-10T16:47:02.107805Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2Izwu2lG6sDd4Wm6UMCgL189EAW\",\n            \"RouteID\": \"2EQanxEfWCL0fcNKmQpbE6Wcg9h\",\n            \"Route\": {\n                \"ID\": \"2EQanxEfWCL0fcNKmQpbE6Wcg9h\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"LHR\",\n                \"DestinationRegion\": \"Europe\",\n                \"NumDaysOut\": 120,\n                \"Distance\": 5359,\n                \"Source\": \"virginatlantic\"\n            },\n            \"Date\": \"2023-08-12\",\n            \"ParsedDate\": \"2023-08-12T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": true,\n            \"JAvailable\": true,\n            \"FAvailable\": null,\n            \"YMileageCost\": \"17500\",\n            \"WMileageCost\": \"26200\",\n            \"JMileageCost\": \"54200\",\n            \"FMileageCost\": null,\n            \"YRemainingSeats\": 9,\n            \"WRemainingSeats\": 9,\n            \"JRemainingSeats\": 7,\n            \"FRemainingSeats\": null,\n            \"YAirlines\": \"VS\",\n            \"WAirlines\": \"VS\",\n            \"JAirlines\": \"VS\",\n            \"FAirlines\": null,\n            \"YDirect\": true,\n            \"WDirect\": true,\n            \"JDirect\": true,\n            \"FDirect\": null,\n            \"Source\": \"virginatlantic\",\n            \"CreatedAt\": \"2022-12-16T13:38:58.244848Z\",\n            \"UpdatedAt\": \"2023-07-10T13:35:24.950461Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2QYTTC11gCV1R8FNKpYugdZTeRv\",\n            \"RouteID\": \"2HmSwbzAS9SnEdtIsf3nkjozpX1\",\n            \"Route\": {\n                \"ID\": \"2HmSwbzAS9SnEdtIsf3nkjozpX1\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"JFK\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 75,\n                \"Distance\": 2582,\n                \"Source\": \"american\"\n            },\n            \"Date\": \"2023-08-13\",\n            \"ParsedDate\": \"2023-08-13T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": true,\n            \"YMileageCost\": \"16000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"44000\",\n            \"FMileageCost\": \"35000\",\n            \"YRemainingSeats\": 0,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 0,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AA\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"AA, B6\",\n            \"FAirlines\": \"AA\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": true,\n            \"Source\": \"american\",\n            \"CreatedAt\": \"2023-05-31T10:38:40.668451Z\",\n            \"UpdatedAt\": \"2023-07-10T13:51:29.756266Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2J7A0f4ospZESYXpILoR8XVc6ON\",\n            \"RouteID\": \"2HmZc5mdC1PWSgwbFfZoW1G7VMp\",\n            \"Route\": {\n                \"ID\": \"2HmZc5mdC1PWSgwbFfZoW1G7VMp\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"LHR\",\n                \"DestinationRegion\": \"Europe\",\n                \"NumDaysOut\": 75,\n                \"Distance\": 5359,\n                \"Source\": \"american\"\n            },\n            \"Date\": \"2023-08-13\",\n            \"ParsedDate\": \"2023-08-13T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": true,\n            \"YMileageCost\": \"30000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"57500\",\n            \"FMileageCost\": \"90500\",\n            \"YRemainingSeats\": 0,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 0,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AA, AS, BA\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"BA\",\n            \"FAirlines\": \"AA\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"american\",\n            \"CreatedAt\": \"2022-12-19T02:55:25.880926Z\",\n            \"UpdatedAt\": \"2023-07-10T14:10:56.755336Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2RFrIjKkhKUFmAp6iwnJvU4YZd1\",\n            \"RouteID\": \"2IZU4neIqrVuxLopVliJC1cgtVI\",\n            \"Route\": {\n                \"ID\": \"2IZU4neIqrVuxLopVliJC1cgtVI\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"JFK\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 2582,\n                \"Source\": \"delta\"\n            },\n            \"Date\": \"2023-08-13\",\n            \"ParsedDate\": \"2023-08-13T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"20000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"90000\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 9,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 9,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"DL\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"DL\",\n            \"FAirlines\": \"\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"delta\",\n            \"CreatedAt\": \"2023-06-15T19:16:32.933806Z\",\n            \"UpdatedAt\": \"2023-07-10T16:47:03.078971Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2RELDg5pdgOvaQowBoION2Fl3h7\",\n            \"RouteID\": \"2Qd8i1CesLLdNQGrQVWTT4A0b1C\",\n            \"Route\": {\n                \"ID\": \"2Qd8i1CesLLdNQGrQVWTT4A0b1C\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"JFK\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 2582,\n                \"Source\": \"alaska\"\n            },\n            \"Date\": \"2023-08-13\",\n            \"ParsedDate\": \"2023-08-13T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"20000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"45000\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 7,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 7,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AS\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"AS\",\n            \"FAirlines\": \"\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"alaska\",\n            \"CreatedAt\": \"2023-06-15T06:22:55.397477Z\",\n            \"UpdatedAt\": \"2023-07-10T16:47:07.421243Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2REL8pZSQrnRHbNOwYsI9d82CWD\",\n            \"RouteID\": \"2Qd8hyjEypv1Fik69IVdBg0WKIK\",\n            \"Route\": {\n                \"ID\": \"2Qd8hyjEypv1Fik69IVdBg0WKIK\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"EWR\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 2561,\n                \"Source\": \"alaska\"\n            },\n            \"Date\": \"2023-08-13\",\n            \"ParsedDate\": \"2023-08-13T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"20000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"45000\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 7,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 7,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AS\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"AS\",\n            \"FAirlines\": \"\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"alaska\",\n            \"CreatedAt\": \"2023-06-15T06:22:16.615959Z\",\n            \"UpdatedAt\": \"2023-07-10T16:47:07.365727Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2QeBGdgQsmdc2DagYeak1V3tHdk\",\n            \"RouteID\": \"2Qd8htSo1HNEVkERlvIlyQg5fBO\",\n            \"Route\": {\n                \"ID\": \"2Qd8htSo1HNEVkERlvIlyQg5fBO\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"LHR\",\n                \"DestinationRegion\": \"Europe\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 5359,\n                \"Source\": \"alaska\"\n            },\n            \"Date\": \"2023-08-13\",\n            \"ParsedDate\": \"2023-08-13T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"30000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"65000\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 9,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 9,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AA, AS, BA, EI\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"BA\",\n            \"FAirlines\": \"\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"alaska\",\n            \"CreatedAt\": \"2023-06-02T11:07:51.137914Z\",\n            \"UpdatedAt\": \"2023-07-10T13:31:44.721702Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2IzwyaVyz2iqQyVOUMTAw8nxxpF\",\n            \"RouteID\": \"2EQanxEfWCL0fcNKmQpbE6Wcg9h\",\n            \"Route\": {\n                \"ID\": \"2EQanxEfWCL0fcNKmQpbE6Wcg9h\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"LHR\",\n                \"DestinationRegion\": \"Europe\",\n                \"NumDaysOut\": 120,\n                \"Distance\": 5359,\n                \"Source\": \"virginatlantic\"\n            },\n            \"Date\": \"2023-08-13\",\n            \"ParsedDate\": \"2023-08-13T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": true,\n            \"JAvailable\": true,\n            \"FAvailable\": null,\n            \"YMileageCost\": \"17500\",\n            \"WMileageCost\": \"26200\",\n            \"JMileageCost\": \"54200\",\n            \"FMileageCost\": null,\n            \"YRemainingSeats\": 9,\n            \"WRemainingSeats\": 9,\n            \"JRemainingSeats\": 9,\n            \"FRemainingSeats\": null,\n            \"YAirlines\": \"VS\",\n            \"WAirlines\": \"VS\",\n            \"JAirlines\": \"VS\",\n            \"FAirlines\": null,\n            \"YDirect\": true,\n            \"WDirect\": true,\n            \"JDirect\": true,\n            \"FDirect\": null,\n            \"Source\": \"virginatlantic\",\n            \"CreatedAt\": \"2022-12-16T13:39:34.693951Z\",\n            \"UpdatedAt\": \"2023-07-10T13:35:46.821076Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2QaT7o6k4Lh4gEvwE65yvA0DAGK\",\n            \"RouteID\": \"2HmSwbzAS9SnEdtIsf3nkjozpX1\",\n            \"Route\": {\n                \"ID\": \"2HmSwbzAS9SnEdtIsf3nkjozpX1\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"JFK\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 75,\n                \"Distance\": 2582,\n                \"Source\": \"american\"\n            },\n            \"Date\": \"2023-08-14\",\n            \"ParsedDate\": \"2023-08-14T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": true,\n            \"YMileageCost\": \"12500\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"35500\",\n            \"FMileageCost\": \"33000\",\n            \"YRemainingSeats\": 0,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 0,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AA, B6\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"AA, B6\",\n            \"FAirlines\": \"AA\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": true,\n            \"Source\": \"american\",\n            \"CreatedAt\": \"2023-06-01T03:35:27.175451Z\",\n            \"UpdatedAt\": \"2023-07-10T13:52:27.667521Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2RHDWlX0LtXplVN8DvyFrqSBtSm\",\n            \"RouteID\": \"2IZU4neIqrVuxLopVliJC1cgtVI\",\n            \"Route\": {\n                \"ID\": \"2IZU4neIqrVuxLopVliJC1cgtVI\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"JFK\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 2582,\n                \"Source\": \"delta\"\n            },\n            \"Date\": \"2023-08-14\",\n            \"ParsedDate\": \"2023-08-14T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"20000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"90000\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 9,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 9,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"DL\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"DL\",\n            \"FAirlines\": \"\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"delta\",\n            \"CreatedAt\": \"2023-06-16T06:49:06.55062Z\",\n            \"UpdatedAt\": \"2023-07-10T16:47:04.016781Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2RGrfqQYkyq6py8HQ05uS7ZywzR\",\n            \"RouteID\": \"2Qd8i1CesLLdNQGrQVWTT4A0b1C\",\n            \"Route\": {\n                \"ID\": \"2Qd8i1CesLLdNQGrQVWTT4A0b1C\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"JFK\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 2582,\n                \"Source\": \"alaska\"\n            },\n            \"Date\": \"2023-08-14\",\n            \"ParsedDate\": \"2023-08-14T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"20000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"45000\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 7,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 7,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AS\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"AS\",\n            \"FAirlines\": \"\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"alaska\",\n            \"CreatedAt\": \"2023-06-16T03:49:24.893782Z\",\n            \"UpdatedAt\": \"2023-07-10T16:47:36.683704Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2RGrYUdNJENKnXY42PQlJQ7e32H\",\n            \"RouteID\": \"2Qd8hyjEypv1Fik69IVdBg0WKIK\",\n            \"Route\": {\n                \"ID\": \"2Qd8hyjEypv1Fik69IVdBg0WKIK\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"EWR\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 2561,\n                \"Source\": \"alaska\"\n            },\n            \"Date\": \"2023-08-14\",\n            \"ParsedDate\": \"2023-08-14T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"17500\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"35000\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 7,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 7,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AS\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"AS\",\n            \"FAirlines\": \"\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"alaska\",\n            \"CreatedAt\": \"2023-06-16T03:48:26.304684Z\",\n            \"UpdatedAt\": \"2023-07-10T16:47:06.881979Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2IzxAHYgbKhxwFWoKfFyaveCF82\",\n            \"RouteID\": \"2EQanxEfWCL0fcNKmQpbE6Wcg9h\",\n            \"Route\": {\n                \"ID\": \"2EQanxEfWCL0fcNKmQpbE6Wcg9h\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"LHR\",\n                \"DestinationRegion\": \"Europe\",\n                \"NumDaysOut\": 120,\n                \"Distance\": 5359,\n                \"Source\": \"virginatlantic\"\n            },\n            \"Date\": \"2023-08-14\",\n            \"ParsedDate\": \"2023-08-14T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": true,\n            \"JAvailable\": true,\n            \"FAvailable\": null,\n            \"YMileageCost\": \"17500\",\n            \"WMileageCost\": \"26200\",\n            \"JMileageCost\": \"54200\",\n            \"FMileageCost\": null,\n            \"YRemainingSeats\": 9,\n            \"WRemainingSeats\": 9,\n            \"JRemainingSeats\": 9,\n            \"FRemainingSeats\": null,\n            \"YAirlines\": \"AF, VS\",\n            \"WAirlines\": \"VS\",\n            \"JAirlines\": \"VS\",\n            \"FAirlines\": null,\n            \"YDirect\": true,\n            \"WDirect\": true,\n            \"JDirect\": true,\n            \"FDirect\": null,\n            \"Source\": \"virginatlantic\",\n            \"CreatedAt\": \"2022-12-16T13:41:07.485006Z\",\n            \"UpdatedAt\": \"2023-07-10T13:36:06.517637Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2QeWX0XhrAW1OZLCXauiczxSsaS\",\n            \"RouteID\": \"2HmSwbzAS9SnEdtIsf3nkjozpX1\",\n            \"Route\": {\n                \"ID\": \"2HmSwbzAS9SnEdtIsf3nkjozpX1\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"JFK\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 75,\n                \"Distance\": 2582,\n                \"Source\": \"american\"\n            },\n            \"Date\": \"2023-08-15\",\n            \"ParsedDate\": \"2023-08-15T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": true,\n            \"YMileageCost\": \"12500\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"33500\",\n            \"FMileageCost\": \"33000\",\n            \"YRemainingSeats\": 0,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 0,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AA, B6\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"AA, B6\",\n            \"FAirlines\": \"AA\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": true,\n            \"Source\": \"american\",\n            \"CreatedAt\": \"2023-06-02T14:02:42.694361Z\",\n            \"UpdatedAt\": \"2023-07-10T13:51:58.267916Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2RJO12KLdJI09fLpVurqrpgm4yX\",\n            \"RouteID\": \"2Qd8hyjEypv1Fik69IVdBg0WKIK\",\n            \"Route\": {\n                \"ID\": \"2Qd8hyjEypv1Fik69IVdBg0WKIK\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"EWR\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 2561,\n                \"Source\": \"alaska\"\n            },\n            \"Date\": \"2023-08-15\",\n            \"ParsedDate\": \"2023-08-15T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"17500\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"45000\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 7,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 6,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AS\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"AS\",\n            \"FAirlines\": \"\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"alaska\",\n            \"CreatedAt\": \"2023-06-17T01:14:58.49062Z\",\n            \"UpdatedAt\": \"2023-07-10T16:47:05.839068Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2RJO6MSfPM0khmBrtLRNeTmjVIB\",\n            \"RouteID\": \"2Qd8i1CesLLdNQGrQVWTT4A0b1C\",\n            \"Route\": {\n                \"ID\": \"2Qd8i1CesLLdNQGrQVWTT4A0b1C\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"JFK\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 2582,\n                \"Source\": \"alaska\"\n            },\n            \"Date\": \"2023-08-15\",\n            \"ParsedDate\": \"2023-08-15T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"15000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"45000\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 7,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 7,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AS\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"AS\",\n            \"FAirlines\": \"\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"alaska\",\n            \"CreatedAt\": \"2023-06-17T01:15:40.267091Z\",\n            \"UpdatedAt\": \"2023-07-10T16:47:06.915131Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2RJwWeBqJt4smuiXBq9DhnCKlwS\",\n            \"RouteID\": \"2IZU4neIqrVuxLopVliJC1cgtVI\",\n            \"Route\": {\n                \"ID\": \"2IZU4neIqrVuxLopVliJC1cgtVI\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"JFK\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 2582,\n                \"Source\": \"delta\"\n            },\n            \"Date\": \"2023-08-15\",\n            \"ParsedDate\": \"2023-08-15T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"17500\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"79500\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 9,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 9,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"DL\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"DL\",\n            \"FAirlines\": \"\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"delta\",\n            \"CreatedAt\": \"2023-06-17T05:58:44.95395Z\",\n            \"UpdatedAt\": \"2023-07-10T16:47:03.801276Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2IzwOw4IK9rEGLyj6XWmuMBDeks\",\n            \"RouteID\": \"2EQanxEfWCL0fcNKmQpbE6Wcg9h\",\n            \"Route\": {\n                \"ID\": \"2EQanxEfWCL0fcNKmQpbE6Wcg9h\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"LHR\",\n                \"DestinationRegion\": \"Europe\",\n                \"NumDaysOut\": 120,\n                \"Distance\": 5359,\n                \"Source\": \"virginatlantic\"\n            },\n            \"Date\": \"2023-08-15\",\n            \"ParsedDate\": \"2023-08-15T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": true,\n            \"JAvailable\": true,\n            \"FAvailable\": null,\n            \"YMileageCost\": \"17500\",\n            \"WMileageCost\": \"26200\",\n            \"JMileageCost\": \"54200\",\n            \"FMileageCost\": null,\n            \"YRemainingSeats\": 9,\n            \"WRemainingSeats\": 6,\n            \"JRemainingSeats\": 7,\n            \"FRemainingSeats\": null,\n            \"YAirlines\": \"VS\",\n            \"WAirlines\": \"VS\",\n            \"JAirlines\": \"VS\",\n            \"FAirlines\": null,\n            \"YDirect\": true,\n            \"WDirect\": true,\n            \"JDirect\": true,\n            \"FDirect\": null,\n            \"Source\": \"virginatlantic\",\n            \"CreatedAt\": \"2022-12-16T13:34:50.608801Z\",\n            \"UpdatedAt\": \"2023-07-10T13:35:17.70168Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2QgapL6B4qpZHgSAuqeveeYNbVP\",\n            \"RouteID\": \"2HmSwbzAS9SnEdtIsf3nkjozpX1\",\n            \"Route\": {\n                \"ID\": \"2HmSwbzAS9SnEdtIsf3nkjozpX1\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"JFK\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 75,\n                \"Distance\": 2582,\n                \"Source\": \"american\"\n            },\n            \"Date\": \"2023-08-16\",\n            \"ParsedDate\": \"2023-08-16T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": true,\n            \"YMileageCost\": \"12500\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"33000\",\n            \"FMileageCost\": \"33000\",\n            \"YRemainingSeats\": 0,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 0,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AA, B6\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"AA, B6\",\n            \"FAirlines\": \"AA\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": true,\n            \"Source\": \"american\",\n            \"CreatedAt\": \"2023-06-03T07:37:39.226186Z\",\n            \"UpdatedAt\": \"2023-07-10T13:52:33.598589Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2RMmJGzQSkn5XoJQ8R3MRRioEd5\",\n            \"RouteID\": \"2Qd8hyjEypv1Fik69IVdBg0WKIK\",\n            \"Route\": {\n                \"ID\": \"2Qd8hyjEypv1Fik69IVdBg0WKIK\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"EWR\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 2561,\n                \"Source\": \"alaska\"\n            },\n            \"Date\": \"2023-08-16\",\n            \"ParsedDate\": \"2023-08-16T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"17500\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"45000\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 7,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 7,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AS\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"AS\",\n            \"FAirlines\": \"\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"alaska\",\n            \"CreatedAt\": \"2023-06-18T06:04:10.859856Z\",\n            \"UpdatedAt\": \"2023-07-10T00:07:44.380744Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2RMgArAvsgNltxeumVQXBIbyYBY\",\n            \"RouteID\": \"2IZU4neIqrVuxLopVliJC1cgtVI\",\n            \"Route\": {\n                \"ID\": \"2IZU4neIqrVuxLopVliJC1cgtVI\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"JFK\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 2582,\n                \"Source\": \"delta\"\n            },\n            \"Date\": \"2023-08-16\",\n            \"ParsedDate\": \"2023-08-16T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"20000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"88000\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 9,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 9,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"DL\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"DL\",\n            \"FAirlines\": \"\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"delta\",\n            \"CreatedAt\": \"2023-06-18T05:13:43.502377Z\",\n            \"UpdatedAt\": \"2023-07-10T16:47:08.41418Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2RMmNUMOtmqixbR4xpx9MLPhLW6\",\n            \"RouteID\": \"2Qd8i1CesLLdNQGrQVWTT4A0b1C\",\n            \"Route\": {\n                \"ID\": \"2Qd8i1CesLLdNQGrQVWTT4A0b1C\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"JFK\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 2582,\n                \"Source\": \"alaska\"\n            },\n            \"Date\": \"2023-08-16\",\n            \"ParsedDate\": \"2023-08-16T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"20000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"45000\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 7,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 7,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AS\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"AS\",\n            \"FAirlines\": \"\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"alaska\",\n            \"CreatedAt\": \"2023-06-18T06:04:44.910568Z\",\n            \"UpdatedAt\": \"2023-07-10T16:47:15.992607Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2J79pFCQsb3S5oKcpMJhJHVzEKj\",\n            \"RouteID\": \"2HmZc5mdC1PWSgwbFfZoW1G7VMp\",\n            \"Route\": {\n                \"ID\": \"2HmZc5mdC1PWSgwbFfZoW1G7VMp\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"LHR\",\n                \"DestinationRegion\": \"Europe\",\n                \"NumDaysOut\": 75,\n                \"Distance\": 5359,\n                \"Source\": \"american\"\n            },\n            \"Date\": \"2023-08-17\",\n            \"ParsedDate\": \"2023-08-17T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": true,\n            \"YMileageCost\": \"30000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"57500\",\n            \"FMileageCost\": \"140500\",\n            \"YRemainingSeats\": 0,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 0,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AA, AS\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"BA\",\n            \"FAirlines\": \"AA\",\n            \"YDirect\": false,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"american\",\n            \"CreatedAt\": \"2022-12-19T02:53:54.605441Z\",\n            \"UpdatedAt\": \"2023-07-10T14:10:54.186853Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2QilKvqOW9tw1M6jgHgkBuq7p6R\",\n            \"RouteID\": \"2HmSwbzAS9SnEdtIsf3nkjozpX1\",\n            \"Route\": {\n                \"ID\": \"2HmSwbzAS9SnEdtIsf3nkjozpX1\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"JFK\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 75,\n                \"Distance\": 2582,\n                \"Source\": \"american\"\n            },\n            \"Date\": \"2023-08-17\",\n            \"ParsedDate\": \"2023-08-17T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": true,\n            \"YMileageCost\": \"16000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"40000\",\n            \"FMileageCost\": \"42500\",\n            \"YRemainingSeats\": 0,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 0,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AA\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"AA, B6\",\n            \"FAirlines\": \"AA\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"american\",\n            \"CreatedAt\": \"2023-06-04T02:03:42.44678Z\",\n            \"UpdatedAt\": \"2023-07-10T13:51:33.355681Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2RPOh1d60biRCxeiEVGXdgkMqmZ\",\n            \"RouteID\": \"2Qd8i1CesLLdNQGrQVWTT4A0b1C\",\n            \"Route\": {\n                \"ID\": \"2Qd8i1CesLLdNQGrQVWTT4A0b1C\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"JFK\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 2582,\n                \"Source\": \"alaska\"\n            },\n            \"Date\": \"2023-08-17\",\n            \"ParsedDate\": \"2023-08-17T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"20000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"55000\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 7,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 7,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AS\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"AS\",\n            \"FAirlines\": \"\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"alaska\",\n            \"CreatedAt\": \"2023-06-19T04:19:24.612054Z\",\n            \"UpdatedAt\": \"2023-07-10T16:47:16.337125Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2RPS1ZULjPxdUMjV7Frl9KJZmwY\",\n            \"RouteID\": \"2IZU4neIqrVuxLopVliJC1cgtVI\",\n            \"Route\": {\n                \"ID\": \"2IZU4neIqrVuxLopVliJC1cgtVI\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"JFK\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 2582,\n                \"Source\": \"delta\"\n            },\n            \"Date\": \"2023-08-17\",\n            \"ParsedDate\": \"2023-08-17T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"20000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"90000\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 9,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 9,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"DL\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"DL\",\n            \"FAirlines\": \"\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"delta\",\n            \"CreatedAt\": \"2023-06-19T04:46:48.714744Z\",\n            \"UpdatedAt\": \"2023-07-10T16:47:08.778158Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2RQFO0SESu7kzmlxHNGNHkJHQA8\",\n            \"RouteID\": \"2Qd8hyjEypv1Fik69IVdBg0WKIK\",\n            \"Route\": {\n                \"ID\": \"2Qd8hyjEypv1Fik69IVdBg0WKIK\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"EWR\",\n                \"DestinationRegion\": \"North America\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 2561,\n                \"Source\": \"alaska\"\n            },\n            \"Date\": \"2023-08-17\",\n            \"ParsedDate\": \"2023-08-17T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"30000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"70000\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 7,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 6,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AS\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"AS\",\n            \"FAirlines\": \"\",\n            \"YDirect\": true,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"alaska\",\n            \"CreatedAt\": \"2023-06-19T11:32:41.764159Z\",\n            \"UpdatedAt\": \"2023-07-10T16:47:16.570698Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2QeB7R9dvhiOoUZQxxyUkfIfrGE\",\n            \"RouteID\": \"2Qd8htSo1HNEVkERlvIlyQg5fBO\",\n            \"Route\": {\n                \"ID\": \"2Qd8htSo1HNEVkERlvIlyQg5fBO\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"LHR\",\n                \"DestinationRegion\": \"Europe\",\n                \"NumDaysOut\": 60,\n                \"Distance\": 5359,\n                \"Source\": \"alaska\"\n            },\n            \"Date\": \"2023-08-17\",\n            \"ParsedDate\": \"2023-08-17T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": false,\n            \"JAvailable\": true,\n            \"FAvailable\": false,\n            \"YMileageCost\": \"30000\",\n            \"WMileageCost\": \"0\",\n            \"JMileageCost\": \"65000\",\n            \"FMileageCost\": \"0\",\n            \"YRemainingSeats\": 7,\n            \"WRemainingSeats\": 0,\n            \"JRemainingSeats\": 3,\n            \"FRemainingSeats\": 0,\n            \"YAirlines\": \"AA, AS, BA, EI\",\n            \"WAirlines\": \"\",\n            \"JAirlines\": \"BA\",\n            \"FAirlines\": \"\",\n            \"YDirect\": false,\n            \"WDirect\": false,\n            \"JDirect\": true,\n            \"FDirect\": false,\n            \"Source\": \"alaska\",\n            \"CreatedAt\": \"2023-06-02T11:06:38.267633Z\",\n            \"UpdatedAt\": \"2023-07-10T05:47:46.420008Z\",\n            \"AvailabilityTrips\": null\n        },\n        {\n            \"ID\": \"2IzwzHKFl5zkDTwHedjfDL3aOwG\",\n            \"RouteID\": \"2EQanxEfWCL0fcNKmQpbE6Wcg9h\",\n            \"Route\": {\n                \"ID\": \"2EQanxEfWCL0fcNKmQpbE6Wcg9h\",\n                \"OriginAirport\": \"SFO\",\n                \"OriginRegion\": \"North America\",\n                \"DestinationAirport\": \"LHR\",\n                \"DestinationRegion\": \"Europe\",\n                \"NumDaysOut\": 120,\n                \"Distance\": 5359,\n                \"Source\": \"virginatlantic\"\n            },\n            \"Date\": \"2023-08-17\",\n            \"ParsedDate\": \"2023-08-17T00:00:00Z\",\n            \"YAvailable\": true,\n            \"WAvailable\": true,\n            \"JAvailable\": true,\n            \"FAvailable\": null,\n            \"YMileageCost\": \"17500\",\n            \"WMileageCost\": \"26200\",\n            \"JMileageCost\": \"54200\",\n            \"FMileageCost\": null,\n            \"YRemainingSeats\": 9,\n            \"WRemainingSeats\": 9,\n            \"JRemainingSeats\": 3,\n            \"FRemainingSeats\": null,\n            \"YAirlines\": \"VS\",\n            \"WAirlines\": \"VS\",\n            \"JAirlines\": \"VS\",\n            \"FAirlines\": null,\n            \"YDirect\": true,\n            \"WDirect\": true,\n            \"JDirect\": true,\n            \"FDirect\": null,\n            \"Source\": \"virginatlantic\",\n            \"CreatedAt\": \"2022-12-16T13:39:40.458588Z\",\n            \"UpdatedAt\": \"2023-07-10T05:40:40.384693Z\",\n            \"AvailabilityTrips\": null\n        }\n    ],\n    \"count\": 42,\n    \"hasMore\": false,\n    \"cursor\": 1689009958\n}"
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
                            "example": "2QSaUXJ0ZuSVqgrRWqkSlXhnVbS"
                          },
                          "RouteID": {
                            "type": "string",
                            "example": "2HmSwbzAS9SnEdtIsf3nkjozpX1"
                          },
                          "Route": {
                            "type": "object",
                            "properties": {
                              "ID": {
                                "type": "string",
                                "example": "2HmSwbzAS9SnEdtIsf3nkjozpX1"
                              },
                              "OriginAirport": {
                                "type": "string",
                                "example": "SFO"
                              },
                              "OriginRegion": {
                                "type": "string",
                                "example": "North America"
                              },
                              "DestinationAirport": {
                                "type": "string",
                                "example": "JFK"
                              },
                              "DestinationRegion": {
                                "type": "string",
                                "example": "North America"
                              },
                              "NumDaysOut": {
                                "type": "integer",
                                "example": 75,
                                "default": 0
                              },
                              "Distance": {
                                "type": "integer",
                                "example": 2582,
                                "default": 0
                              },
                              "Source": {
                                "type": "string",
                                "example": "american"
                              }
                            }
                          },
                          "Date": {
                            "type": "string",
                            "example": "2023-08-11"
                          },
                          "ParsedDate": {
                            "type": "string",
                            "example": "2023-08-11T00:00:00Z"
                          },
                          "YAvailable": {
                            "type": "boolean",
                            "example": true,
                            "default": true
                          },
                          "WAvailable": {
                            "type": "boolean",
                            "example": false,
                            "default": true
                          },
                          "JAvailable": {
                            "type": "boolean",
                            "example": true,
                            "default": true
                          },
                          "FAvailable": {
                            "type": "boolean",
                            "example": true,
                            "default": true
                          },
                          "YMileageCost": {
                            "type": "string",
                            "example": "12500"
                          },
                          "WMileageCost": {
                            "type": "string",
                            "example": "0"
                          },
                          "JMileageCost": {
                            "type": "string",
                            "example": "33000"
                          },
                          "FMileageCost": {
                            "type": "string",
                            "example": "33000"
                          },
                          "YRemainingSeats": {
                            "type": "integer",
                            "example": 0,
                            "default": 0
                          },
                          "WRemainingSeats": {
                            "type": "integer",
                            "example": 0,
                            "default": 0
                          },
                          "JRemainingSeats": {
                            "type": "integer",
                            "example": 0,
                            "default": 0
                          },
                          "FRemainingSeats": {
                            "type": "integer",
                            "example": 0,
                            "default": 0
                          },
                          "YAirlines": {
                            "type": "string",
                            "example": "AA, B6"
                          },
                          "WAirlines": {
                            "type": "string",
                            "example": ""
                          },
                          "JAirlines": {
                            "type": "string",
                            "example": "AA, B6"
                          },
                          "FAirlines": {
                            "type": "string",
                            "example": "AA"
                          },
                          "YDirect": {
                            "type": "boolean",
                            "example": true,
                            "default": true
                          },
                          "WDirect": {
                            "type": "boolean",
                            "example": false,
                            "default": true
                          },
                          "JDirect": {
                            "type": "boolean",
                            "example": true,
                            "default": true
                          },
                          "FDirect": {
                            "type": "boolean",
                            "example": true,
                            "default": true
                          },
                          "Source": {
                            "type": "string",
                            "example": "american"
                          },
                          "CreatedAt": {
                            "type": "string",
                            "example": "2023-05-29T08:37:32.218426Z"
                          },
                          "UpdatedAt": {
                            "type": "string",
                            "example": "2023-07-10T13:52:23.343425Z"
                          },
                          "AvailabilityTrips": {
                            "type": [
                              "array",
                              "null"
                            ],
                            "description": "Trip-level details when include_trips is true. A mixed-cabin trip includes MixedCabinPct when that percentage is available; it is the percentage of the trip's distance flown below the reported Cabin.",
                            "items": {
                              "$ref": "#/paths/~1trips~1{id}/get/responses/200/content/application~1json/schema/properties/data/items"
                            }
                          }
                        }
                      }
                    },
                    "count": {
                      "type": "integer",
                      "example": 42,
                      "default": 0
                    },
                    "hasMore": {
                      "type": "boolean",
                      "example": false,
                      "default": true
                    },
                    "cursor": {
                      "type": "integer",
                      "example": 1689009958,
                      "default": 0
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