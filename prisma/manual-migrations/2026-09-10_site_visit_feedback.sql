-- § Phase 7: customer feedback for a completed site visit, reached via a
-- WhatsApp link carrying a random token whose SHA-256 hash is stored here
-- (the raw token itself is never persisted).
CREATE TABLE `SiteVisitFeedback` (
  id INT AUTO_INCREMENT PRIMARY KEY,
  site_visit_id INT NOT NULL,
  rated_employee_id INT NOT NULL,
  token_hash VARCHAR(191) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  submitted_at DATETIME(3) NULL,
  rating INT NULL,
  on_time BOOLEAN NULL,
  answered_questions BOOLEAN NULL,
  property_as_described BOOLEAN NULL,
  comment TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE KEY SiteVisitFeedback_site_visit_id_key (site_visit_id),
  UNIQUE KEY SiteVisitFeedback_token_hash_key (token_hash),
  KEY SiteVisitFeedback_rated_employee_id_idx (rated_employee_id),
  KEY SiteVisitFeedback_expires_at_idx (expires_at),
  CONSTRAINT SiteVisitFeedback_site_visit_id_fkey FOREIGN KEY (site_visit_id) REFERENCES `SiteVisitBooking`(id) ON DELETE CASCADE,
  CONSTRAINT SiteVisitFeedback_rated_employee_id_fkey FOREIGN KEY (rated_employee_id) REFERENCES `Employee`(id)
);
