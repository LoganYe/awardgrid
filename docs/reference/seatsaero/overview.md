---
updatedAt: 2025-12-22T19:29:46.000Z
---

Fetch the complete documentation index at: https://developers.seats.aero/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Overview

You can use Login with Seats.aero to easily integrate award travel into your consumer applications. With a standards-compliant OAuth2 flow, you can ask your users to connect their Seats.aero Pro accounts to your application and access award travel data using their subscription.

## Getting Started

Eligible Pro users can create new OAuth2 apps in the **Apps** tab at <https://seats.aero/settings>. Save your client ID and client secret and store them somewhere safe. Never expose your client secret on the frontend.

Not all Pro users can access the partner API key or create new OAuth2 apps. We may limit access to the API by geographical location or for any reason in our sole discretion.

## User Flow

Send users from your product to the OAuth2 Consent flow, where they will be informed of the implications of connecting their accounts. If they agree, they will be taken to your application's `redirect_uri` with a `code` and `state`. You can use these in the OAuth2 Token API to obtain an access token and refresh token. The access token allows you to call the partner APIs on behalf of your user. On the server side only, refresh the access token using the refresh token.

Refresh tokens remain valid until the user revokes your app's permissions inside Seats.aero or their subscription ends. You can bring users back through the consent flow if this occurs.

## Using Access Tokens

You can provide access tokens (starting with `seats:ota`) to any partner API endpoint except for live search. Send the API key in the `Partner-Authorization` header with a `Bearer` prefix. For example, `Partner-Authorization: Bearer seats:ota:123`.

## Limitations

The access token acts the same as the user's own API key, including the 1,000 requests per day limit. This limit is shared across all OAuth applications that the user connects to their account and any usage of their personal API key. Your use of the API must always comply with the [OAuth Addendum](https://seats.aero/oauth2/addendum) you agreed to when creating the application.

OAuth apps are unapproved by default and have a maximum of 10 users. Approval is free to remove the limit; contact <support@seats.aero> with your client ID for more information.