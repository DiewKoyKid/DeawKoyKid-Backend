// One account can hold both profiles — someone who books trips and also guides
// them — so roles are a list rather than a single value. Expects the user to
// have been loaded with its `customer` and `provider` relations selected.
function rolesFor(user) {
  const roles = [];
  if (user.customer) roles.push("CUSTOMER");
  if (user.provider) roles.push("PROVIDER");
  return roles;
}

module.exports = { rolesFor };
