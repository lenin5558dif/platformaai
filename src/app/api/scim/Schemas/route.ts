import { NextResponse } from "next/server";
import { validateScimRequest } from "@/lib/scim";

export async function GET(request: Request) {
  const auth = await validateScimRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 2,
      startIndex: 1,
      itemsPerPage: 2,
      Resources: [
        {
          id: "urn:ietf:params:scim:schemas:core:2.0:User",
          name: "User",
          description: "User resource",
          attributes: [],
        },
        {
          id: "urn:ietf:params:scim:schemas:core:2.0:Group",
          name: "Group",
          description: "Group resource",
          attributes: [],
        },
      ],
    },
    {
      headers: { "Content-Type": "application/scim+json" },
    }
  );
}
