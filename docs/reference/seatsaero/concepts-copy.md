---
updatedAt: 2026-08-28T00:22:46.000Z
---

Fetch the complete documentation index at: https://developers.seats.aero/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Concepts

The Seats.aero API has a few concepts that are important to be aware of.

# Sources

A source in the Seats.aero API is one mileage program. For example, the `aeroplan` source contains results for Air Canada Aeroplan. Every mileage program has its own source; they are listed below.

Not all programs provide us the number of available seats or individual flight data. In these cases, you may see availability listed with zero seats, or no results for trip data.

| Source           | Mileage Program             | Supported Cabins | Has Seat Count | Has Trip Data |
| :--------------- | :-------------------------- | :--------------- | :------------- | :------------ |
| `eurobonus`      | SAS EuroBonus               | Y/J              | Yes            | Yes           |
| `virginatlantic` | Virgin Atlantic Flying Club | Y/W/J            | Yes            | Yes           |
| `aeromexico`     | Aeromexico Club Premier     | Y/W/J            | Yes            | Yes           |
| `american`       | American Airlines           | Y/W/J/F          | No\*\*         | Yes           |
| `delta`          | Delta SkyMiles              | Y/W/J            | Yes            | Yes           |
| `etihad`         | Etihad Guest                | Y/J/F            | Yes            | Yes           |
| `united`         | United MileagePlus          | Y/W/J/F          | Yes            | Yes           |
| `emirates`       | Emirates Skywards           | Y/W/J/F          | No             | Yes\*         |
| `aeroplan`       | Air Canada Aeroplan         | Y/W/J/F          | Yes†           | Yes           |
| `alaska`         | Alaska Mileage Plan         | Y/W/J/F          | Yes            | Yes           |
| `velocity`       | Virgin Australia Velocity   | Y/W/J/F          | Yes            | Yes           |
| `qantas`         | Qantas Frequent Flyer       | Y/W/J/F          | No             | Yes           |
| `connectmiles`   | Copa ConnectMiles           | Y/J/F            | No             | Yes           |
| `azul`           | Azul TudoAzul               | Y/J              | No             | Yes           |
| `smiles`         | GOL Smiles                  | Y/W/J/F          | Yes            | Yes           |
| `flyingblue`     | Air France/KLM Flying Blue  | Y/W/J/F          | Yes            | Yes           |
| `jetblue`        | JetBlue TrueBlue            | Y/W/J/F          | Yes            | Yes           |
| `qatar`          | Qatar Privilege Club        | Y/J/F            | No             | Yes\*\*\*     |
| `turkish`        | Turkish Miles & Smiles      | Y/J              | No             | Yes\*\*\*     |
| `singapore`      | Singapore KrisFlyer         | Y/W/J/F          | No             | Yes\*\*\*     |
| `ethiopian`      | Ethiopian ShebaMiles        | Y/J              | Yes            | Yes           |
| `saudia`         | Saudi AlFursan              | Y/J/F            | Yes            | Yes           |
| `finnair`        | Finnair Plus                | Y/WJ/F           | Yes            | Yes           |
| `lufthansa`      | Lufthansa Miles\&More       | Y/J/F            | Yes            | Yes           |
| `frontier`       | Frontier Airlines           | Y                | No             | Yes           |
| `spirit`         | Spirit Airlines             | Y                | Yes            | Yes           |

`*` In flights with connections, some fields may be missing.

\*\* In some cases when the number of seats is low, seat counts are provided. Otherwise, it will be 0.

\*\*\* Taxes and surcharges are not available for this mileage program.

† Seat count is typically available but may be set to zero in rare cases.

# Cached Search vs Bulk Availability

Seats.aero has two main APIs to run searches on our cached availability data. **Cached Search** is the most common endpoint, but **Bulk Availability** can be used when many results are required.

* **Cached Search** allows you to search for availability between specific airports within specific date ranges across all mileage programs. For example, if you want to search from a few airports in the US to a few airports in Australia in June, you would use this endpoint. It is akin to our [Search](https://seats.aero/search) feature on Seats.aero.
* **Bulk Availability** allows you to retrieve a large amount of availability for one specific mileage program. For example, if you want to see all of the availability from North America to Europe on Delta SkyMiles, you would use this endpoint. It is similar to our [Explore](https://seats.aero/aeroplan) feature on Seats.aero.

# Availability Objects

Seats.aero uses a summary object called `Availability` to summarize the availability for a route on a given departure date. For example, all flights available on Alaska Mileage Plan from SFO to LAX departing on `2023-08-11` are summarized into one `Availability` object. Flights on the same date and route but available from United would be summarized into a different `Availability` object.

Imagine the following flights are available on Alaska Mileage Plan on `2024-03-16`:

* AS123, direct, SFO to LAX, economy with 5 seats @ 5,000 miles, business with one seat @ 10,000 miles
* AA456, one stop, SFO to LAX, economy with 7 seats @ 7,500 miles, business with three seats @ 15,000 miles

These would be summarized into the following availability object:

```json json
{
  "ID": "abcdef",
  "Route": {
    "ID": "ghijkl",
    "OriginAirport": "SFO",
    "DestinationAirport": "LAX",
    "Source": "alaska"
  },
  "Date": "2024-03-16",
  "YAvailable": true,
  "YDirect": true,
  "YMileageCost": "5000",
  "YRemainingSeats": 7,
  "YAirlines": "AA, AS",
  "JAvailable": true,
  "JDirect": true,
  "JMileageCost": "10000",
  "JRemainingSeats": 3,
  "JAirlines": "AA, AS",
  "Source": "alaska"
}
```

## Availability Trips

The partner API can obtain individual availability trips from a summary Availability object. To do this, you call the Get Trips API with the `ID` of the Availability. Availability trips are more specific and represent one cabin being available on a particular set of flight numbers. Summary Availability objects usually have many availability trips.

Here is an example trip, where a passenger would board flight `CM326` and then `TK800` in business class, departing at `2024-05-01T13:52:00Z` and arriving at `2024-05-02T16:45:00Z`. The passenger would pay 70,000 miles + $12.90 in taxes, and over 9 seats are remaining. All times are in airport local times, so the departure and arrival times are already native to their respective airports.

```
{
    "ID": "2S8Cm9dHORWWKpoCkxfRkZa0e5l",
    "RouteID": "2B9HOBW9EOvJQDTQqxc3UKEhhur",
    "AvailabilityID": "2PPrELk9WcfJaNREWEPXypvhXAD",
    "AvailabilitySegments": [
        {
            "ID": "2S8CmA8bXa9KHaxZfUtihUzRTPd",
            "RouteID": "2B9HOBW9EOvJQDTQqxc3UKEhhur",
            "AvailabilityID": "2PPrELk9WcfJaNREWEPXypvhXAD",
            "AvailabilityTripID": "2S8Cm9dHORWWKpoCkxfRkZa0e5l",
            "FlightNumber": "CM326",
            "Distance": 966,
            "FareClass": "I",
            "AircraftName": "739",
            "AircraftCode": "739",
            "OriginAirport": "CUN",
            "DestinationAirport": "PTY",
            "DepartsAt": "2024-05-01T13:52:00Z",
            "ArrivesAt": "2024-05-01T16:31:00Z",
            "CreatedAt": "2023-07-05T01:02:57.782804Z",
            "UpdatedAt": "2023-07-08T07:12:25.266914Z",
            "Source": "lifemiles",
            "Order": 0
        },
        {
            "ID": "2S8CmEryWzLYnioVN6fJ2Ue5Lg8",
            "RouteID": "2B9HOBW9EOvJQDTQqxc3UKEhhur",
            "AvailabilityID": "2PPrELk9WcfJaNREWEPXypvhXAD",
            "AvailabilityTripID": "2S8Cm9dHORWWKpoCkxfRkZa0e5l",
            "FlightNumber": "TK800",
            "Distance": 6739,
            "FareClass": "I",
            "AircraftName": "77W",
            "AircraftCode": "77W",
            "OriginAirport": "PTY",
            "DestinationAirport": "IST",
            "DepartsAt": "2024-05-01T20:05:00Z",
            "ArrivesAt": "2024-05-02T16:45:00Z",
            "CreatedAt": "2023-07-05T01:02:57.782804Z",
            "UpdatedAt": "2023-07-08T07:12:25.266914Z",
            "Source": "lifemiles",
            "Order": 1
        }
    ],
    "TotalDuration": 1133,
    "Stops": 1,
    "Carriers": "CM, TK",
    "RemainingSeats": 9,
    "MileageCost": 70000,
    "TotalTaxes": 1290,
    "TaxesCurrency": "",
    "TaxesCurrencySymbol": "",
    "AllianceCost": 87944,
    "FlightNumbers": "CM326, TK800",
    "DepartsAt": "2024-05-01T13:52:00Z",
    "Cabin": "business",
    "ArrivesAt": "2024-05-02T16:45:00Z",
    "CreatedAt": "2023-07-05T01:02:57.782804Z",
    "UpdatedAt": "2023-07-08T07:12:25.266914Z",
    "Source": "lifemiles"
}
```

## Mixed-cabin itineraries

Cached Search, Bulk Availability, and Get Trips exclude itineraries with any distance below their reported `Cabin` by default. To include mixed-cabin itineraries, pass `min_cabin_pct` as a whole number from 0 to 100. The value is the minimum percentage of the journey's distance that must be flown in the reported `Cabin` or higher. For example, `min_cabin_pct=75` allows up to 25% of the journey's distance to be flown in a lower cabin. Omitting the parameter, or setting it to `100`, preserves the default.

Returned mixed-cabin trips include `MixedCabinPct` when that percentage is available. It is the inverse measurement: the percentage of the journey's distance flown below the reported `Cabin`. This field is omitted when no distance is flown below that cabin. Mixed-cabin availability and percentage reporting depend on the mileage program and route.

Live Search does not accept `min_cabin_pct`. Set `disable_filters` to `true` to include mixed-cabin live results where the mileage program supports them. This also disables the dynamic-pricing and mismatched-airport filters.

## Live Searches

Live searches only return an array of availability trips, there is no summary object. The identifiers returned in live search responses are not committed to our database and cannot be used in other Seats.aero APIs.

## Pagination

All Seats.aero APIs use the pagination concept of a `skip` parameter along with a `cursor`. The skip parameter should be set to the number of results you have already retrieved from the API for this search, and the cursor should be set to the `cursor` field in the first response you received for the search.

The `cursor` provides consistent ordering for subsequent calls to the API. However, in rare cases, it is possible for objects to shift over time and be duplicated in subsequent responses. You should handle cases where the same object appears on multiple pages. Objects can be deduplicated by their `ID` field.

Currently, the `cursor` is a Unix timestamp set to the first response's timestamp. You should treat it as an opaque integer when possible.