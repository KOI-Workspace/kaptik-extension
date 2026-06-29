function decodeTokenPlan(token) {
  try {
    const segment = token.split(".")[1];
    if (!segment) return "free";
    const payload = JSON.parse(atob(segment.replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.plan === "basic" || payload.plan === "pro") return payload.plan;
  } catch (e) { console.error(e); }
  return "free";
}

// simulate a JWT
const payload = { plan: "pro" };
const token = "header." + btoa(JSON.stringify(payload)) + ".signature";
console.log(decodeTokenPlan(token));
