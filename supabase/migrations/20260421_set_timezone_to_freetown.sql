-- Set pharmacy timezone to Africa/Freetown (Sierra Leone)
UPDATE pharmacies 
SET timezone = 'Africa/Freetown'
WHERE timezone = 'UTC' OR timezone IS NULL;

-- Verify the update
SELECT id, name, timezone FROM pharmacies;
