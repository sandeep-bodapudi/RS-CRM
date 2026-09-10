-- Multi preferred-location support (§ Phase 2). Additive only — Lead.preferred_location
-- scalar column is untouched and keeps being the primary/first entry.
CREATE TABLE LeadPreferredLocation (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  location VARCHAR(191) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY LeadPreferredLocation_lead_id_location_key (lead_id, location),
  KEY LeadPreferredLocation_lead_id_idx (lead_id),
  CONSTRAINT LeadPreferredLocation_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES `Lead`(id) ON DELETE CASCADE
);
