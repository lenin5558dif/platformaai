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
          id: "User",
          name: "User",
          endpoint: "/Users",
          schema: "urn:ietf:params:scim:schemas:core:2.0:User",
          description: "User accounts",
        },
        {
          id: "Group",
          name: "Group",
          endpoint: "/Groups",
          schema: "urn:ietf:params:scim:schemas:core:2.0:Group",
          description: "Cost center groups",
        },
      ],
    },
    {
      headers: { "Content-Type": "application/scim+json" },
    }
  );
}
