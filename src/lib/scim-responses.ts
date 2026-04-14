import type { User, CostCenter } from "@prisma/client";

const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
const LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";

export function scimListResponse<T>(resources: T[], totalResults?: number) {
  return {
    schemas: [LIST_SCHEMA],
    totalResults: totalResults ?? resources.length,
    startIndex: 1,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

export function scimUserResource(user: User, costCenter?: CostCenter | null) {
  const email = user.email ?? "";
  const groups = costCenter
    ? [{ value: costCenter.id, display: costCenter.name }]
    : [];

  return {
    schemas: [USER_SCHEMA],
    id: user.id,
    userName: email || user.telegramId || user.id,
    active: user.isActive,
    displayName: email || user.telegramId || user.id,
    emails: email ? [{ value: email, primary: true }] : [],
    groups,
    meta: {
      resourceType: "User",
    },
  };
}

export function scimGroupResource(costCenter: CostCenter, members?: User[]) {
  return {
    schemas: [GROUP_SCHEMA],
    id: costCenter.id,
    displayName: costCenter.name,
    members:
      members?.map((member) => ({ value: member.id })) ?? [],
    meta: {
      resourceType: "Group",
    },
  };
}
