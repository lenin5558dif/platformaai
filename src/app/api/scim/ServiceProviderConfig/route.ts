import { NextResponse } from "next/server";
import { validateScimRequest } from "@/lib/scim";

export async function GET(request: Request) {
  const auth = await validateScimRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    {
      schemas: [
        "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig",
      ],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: "oauthbearertoken",
          name: "Bearer Token",
          description: "Bearer token authentication",
          primary: true,
        },
      ],
    },
    {
      headers: { "Content-Type": "application/scim+json" },
    }
  );
}
