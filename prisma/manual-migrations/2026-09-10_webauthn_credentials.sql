-- § Phase 6: app-lock via platform-authenticator (WebAuthn) credentials.
CREATE TABLE `WebAuthnCredential` (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT NOT NULL,
  credential_id VARCHAR(191) NOT NULL,
  public_key TEXT NOT NULL,
  counter INT NOT NULL DEFAULT 0,
  device_label VARCHAR(191) NULL,
  transports VARCHAR(191) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at DATETIME(3) NULL,

  UNIQUE KEY WebAuthnCredential_credential_id_key (credential_id),
  KEY WebAuthnCredential_employee_id_idx (employee_id),
  CONSTRAINT WebAuthnCredential_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES `Employee`(id) ON DELETE CASCADE
);
