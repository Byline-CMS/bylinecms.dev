---
'@byline/admin': major
'@byline/core': major
'@byline/host-tanstack-start': major
---

Removed deprecated compatibility APIs from the configuration, read-context, and sign-in surfaces. Collection admin definitions now use `itemView` exclusively; `UnionRowValue`, `ReadContext.beforeReadCache`, legacy sign-in route overrides, and `SignInForm.callbackUrl` are no longer available.
