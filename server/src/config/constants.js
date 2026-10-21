/** Domain vocabulary shared by validation, AI prompts and the API. */
export const CATEGORIES = {
  royalty_payments: 'Royalty & Payments',
  isbn_metadata: 'ISBN & Metadata Issues',
  printing_quality: 'Printing & Quality',
  distribution_availability: 'Distribution & Availability',
  book_status_production: 'Book Status & Production Updates',
  general_inquiry: 'General Inquiry',
};
export const CATEGORY_KEYS = Object.keys(CATEGORIES);

export const PRIORITIES = ['critical', 'high', 'medium', 'low'];
export const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
export const OPEN_STATUSES = ['open', 'in_progress'];
