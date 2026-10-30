-- Safe for an already-initialized V15.1 database.
-- Only update the exact old reference, never overwrite photos uploaded by admin.
UPDATE property_photos
SET image_url='https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=85'
WHERE property_id=8 AND image_url='https://images.unsplash.com/photo-1574643156929-51fa098b0394?auto=format&fit=crop&w=1200&q=85';

UPDATE room_types
SET image_url='https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=85'
WHERE property_id=8 AND image_url='https://images.unsplash.com/photo-1574643156929-51fa098b0394?auto=format&fit=crop&w=1200&q=85';
