# Shifty Video Compressor

Servicio para comprimir videos de entrevistas antes de subirlos a Supabase Storage.

## Variables de entorno necesarias en Railway

- `SUPABASE_URL` - URL de tu proyecto Supabase
- `SUPABASE_SERVICE_KEY` - Service Role Key de Supabase (NO la anon key)

## Endpoint

POST `/compress`
- Body: multipart/form-data con campo `video`
- Respuesta: JSON con URL del video comprimido
