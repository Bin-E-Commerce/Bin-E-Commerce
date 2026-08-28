ALTER TABLE products
  ADD COLUMN IF NOT EXISTS source_platform varchar(30),
  ADD COLUMN IF NOT EXISTS external_product_id varchar(100),
  ADD COLUMN IF NOT EXISTS source_url text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_source_external
  ON products (source_platform, external_product_id)
  WHERE source_platform IS NOT NULL AND external_product_id IS NOT NULL;

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS source_platform varchar(30),
  ADD COLUMN IF NOT EXISTS external_category_id varchar(100),
  ADD COLUMN IF NOT EXISTS source_url text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_slug ON categories (slug);

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS source_platform varchar(30),
  ADD COLUMN IF NOT EXISTS external_brand_id varchar(100);

CREATE UNIQUE INDEX IF NOT EXISTS uq_brands_slug ON brands (slug);

ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS source_platform varchar(30),
  ADD COLUMN IF NOT EXISTS external_shop_id varchar(100);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shops_slug ON shops (slug);

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS external_variant_id varchar(100);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_variants_sku ON product_variants (sku);

ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS external_image_id varchar(150);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_images_product_url
  ON product_images (product_id, image_url);

ALTER TABLE product_options
  ADD CONSTRAINT uq_product_options_product_name UNIQUE (product_id, name);

ALTER TABLE product_option_values
  ADD CONSTRAINT uq_product_option_values_option_value UNIQUE (option_id, value);

ALTER TABLE product_variant_option_values
  ADD CONSTRAINT uq_variant_option_values UNIQUE (variant_id, option_value_id);

ALTER TABLE inventories
  ADD CONSTRAINT uq_inventories_variant UNIQUE (variant_id);

ALTER TABLE attributes
  ADD COLUMN IF NOT EXISTS slug varchar(160),
  ADD COLUMN IF NOT EXISTS external_attribute_id varchar(150);

CREATE UNIQUE INDEX IF NOT EXISTS uq_attributes_category_slug
  ON attributes (category_id, slug);

ALTER TABLE product_attribute_values
  ADD CONSTRAINT uq_product_attribute_values_product_attribute UNIQUE (product_id, attribute_id);

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS source_platform varchar(30),
  ADD COLUMN IF NOT EXISTS external_review_id varchar(120);

CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_source_external
  ON reviews (source_platform, external_review_id)
  WHERE source_platform IS NOT NULL AND external_review_id IS NOT NULL;
