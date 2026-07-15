/** Match records whose hotel_id equals the requested hotelId. */
export function hotelIdScopeFilter(hotelId: string) {
  const normalized = String(hotelId);

  return {
    $expr: {
      $eq: [{ $toString: '$hotel_id' }, normalized],
    },
  };
}
