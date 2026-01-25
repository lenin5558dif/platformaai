## 1. Implementation

- [ ] 1.1 Add admin role check to refill endpoint
- [ ] 1.2 Return 403 Forbidden for non-admin users
- [ ] 1.3 Add audit logging for all refill attempts
- [ ] 1.4 Write unit tests for authorization check
- [ ] 1.5 Write integration test for refill rejection

## 2. Documentation

- [ ] 2.1 Update API documentation for refill endpoint
- [ ] 2.2 Document admin-only access requirement

## 3. Verification

- [ ] 3.1 Manual test: regular user receives 403
- [ ] 3.2 Manual test: admin user can refill
- [ ] 3.3 Review audit logs for completeness
