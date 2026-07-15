// Seed data removed — the application should rely exclusively on live data.
// This file intentionally does not export any demo arrays or insert demo documents.
export async function seedDatabase() {
  // No-op on purpose. If manual seeding is required in the future, use a separate one-off script.
  return {
    seededHotels: false,
    seededProperties: false,
    seededReviews: false,
    seededUsers: false,
    bookingCount: 0,
  };
}