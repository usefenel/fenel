The `sns-synthetic-*.pem` files are publicly committed test signing material,
generated specifically for the SNS verification regression suite. They have no
AWS authority and are never used outside tests. The certificate's validity dates
anchor test timestamps, so these fixtures do not depend on the current date.
