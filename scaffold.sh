#!/bin/bash
# Run this from the root of your str-ops repo

mkdir -p api/routes
mkdir -p api/services
mkdir -p lib
mkdir -p public/css
mkdir -p public/js
mkdir -p public/views
mkdir -p scripts/importers
mkdir -p supabase

# Root files
touch .env.example
touch .gitignore
touch vercel.json
touch package.json
touch README.md

# API routes
touch api/routes/reservations.js
touch api/routes/expenses.js
touch api/routes/reports.js
touch api/routes/upload.js
touch api/routes/properties.js

# Services
touch api/services/classifier.js
touch api/services/reportGenerator.js
touch api/services/aiSummary.js

# Shared lib
touch lib/supabase.js
touch lib/propertyMap.js

# Frontend CSS
touch public/css/tokens.css
touch public/css/base.css
touch public/css/nav.css
touch public/css/card.css
touch public/css/table.css
touch public/css/form.css
touch public/css/report.css

# Frontend JS
touch public/js/dashboard.js
touch public/js/upload.js
touch public/js/reports.js

# Frontend views
touch public/views/index.html
touch public/views/dashboard.html
touch public/views/admin.html
touch public/views/reports.html

# Importers
touch scripts/importers/igms.js
touch scripts/importers/baselane.js

# Supabase
touch supabase/schema.sql
touch supabase/seed.sql

echo "Scaffold complete."