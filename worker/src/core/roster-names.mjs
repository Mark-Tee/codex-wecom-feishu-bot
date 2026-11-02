// Normalize only for personnel matching. Never mutate the source roster cell or
// attach meaning (count, shift, duration) to its numeric prefix.
export function rosterNames(value) {
  return String(value || "").split(/[、,，;；/\s]+/u)
    .map((name) => name.replace(/^\d+/, "").trim())
    .filter(Boolean);
}
