// Kiểm thử business rule của planner bằng node:test, không gọi HTTP hay database thật.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    ShopProductBatchPlannerService,
} = require('../dist/services/shop-product-batch-planner.service.js');

// Tạo candidate tối giản nhưng giữ đủ seller/group/listing key để test quota deterministic.
function createCandidates(shopCount, groupCount, duplicate = false) {
    const candidates = [];
    for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
        for (let shopIndex = 0; shopIndex < shopCount; shopIndex += 1) {
            const sellerId = `shop-${shopIndex}`;
            const catalogId = `product-${groupIndex}`;
            candidates.push({
                listingKey: `tiki:${catalogId}:seller:${sellerId}`,
                catalogExternalId: catalogId,
                sellerExternalId: sellerId,
                productName: `Product ${groupIndex}`,
                canonicalGroupKey: `group-${groupIndex}`,
                sourceUrl: `https://tiki.vn/p${groupIndex}`,
                sourceItem: {
                    externalId: catalogId,
                    listingKey: `tiki:${catalogId}:seller:${sellerId}`,
                    catalogExternalId: catalogId,
                    sellerExternalId: sellerId,
                    name: `Product ${groupIndex}`,
                    sourceUrl: `https://tiki.vn/p${groupIndex}`,
                },
            });
        }
    }
    if (duplicate) candidates.push({ ...candidates[0] });
    return candidates;
}

// Bảo đảm planner loại duplicate và đạt đồng thời quota shop/group khi nguồn đủ dữ liệu.
test('should deduplicate listings and satisfy shop/group quotas', () => {
    // Arrange
    const target = new ShopProductBatchPlannerService();
    const candidates = createCandidates(6, 20, true);

    // Act
    const result = target.buildPlan(candidates, {
        targetListings: 120,
        minProductsPerShop: 20,
        maxProductsPerShop: 30,
        minShopsPerGroup: 5,
        maxShopsPerGroup: 10,
    });

    // Assert
    assert.equal(result.selectedListings.length, 120);
    assert.equal(result.shortfall, 0);
    assert.deepEqual(
        Object.values(result.productsPerShop),
        [20, 20, 20, 20, 20, 20],
    );
    assert.deepEqual(
        new Set(Object.values(result.groupCoverage)),
        new Set([6]),
    );
});

// Bảo đảm group chỉ có dưới 5 seller không được đưa vào batch cân bằng.
test('should report shortfall when no group has minimum seller coverage', () => {
    // Arrange
    const target = new ShopProductBatchPlannerService();
    const candidates = createCandidates(4, 20);

    // Act
    const result = target.buildPlan(candidates, {
        targetListings: 80,
        minProductsPerShop: 20,
        maxProductsPerShop: 30,
        minShopsPerGroup: 5,
        maxShopsPerGroup: 10,
    });

    // Assert
    assert.equal(result.selectedListings.length, 0);
    assert.equal(result.shortfall, 80);
    assert.equal(result.eligibleGroups, 0);
});

// Bảo đảm planner dùng khóa brand/tên/category exact khi các catalog ID khác nhau nhưng seller coverage đủ.
test('should merge exact fallback group when catalog ids differ', () => {
    // Arrange
    const target = new ShopProductBatchPlannerService();
    const candidates = createCandidates(6, 1).map((candidate, index) => ({
        ...candidate,
        catalogExternalId: `different-catalog-${index}`,
        canonicalGroupKey: `catalog-${index}`,
        productName: 'Same product name',
        brandName: 'Same brand',
        categoryName: 'Same category',
    }));

    // Act
    const result = target.buildPlan(candidates, {
        targetListings: 6,
        minProductsPerShop: 1,
        maxProductsPerShop: 30,
        minShopsPerGroup: 5,
        maxShopsPerGroup: 10,
    });

    // Assert
    assert.equal(result.selectedListings.length, 6);
    assert.equal(result.eligibleGroups, 1);
    assert.deepEqual(Object.values(result.groupCoverage), [6]);
});

// Bảo đảm chế độ catalog duy nhất ưu tiên đủ quota từng shop thay vì rải lẻ rồi loại ở bước reconcile.
test('should balance unique catalog products across shops', () => {
    // Arrange
    const target = new ShopProductBatchPlannerService();
    const candidates = createCandidates(6, 20).map((candidate, index) => ({
        ...candidate,
        catalogExternalId: `unique-${index}`,
        listingKey: `${candidate.listingKey}-${index}`,
        canonicalGroupKey: `${candidate.canonicalGroupKey}-${candidate.sellerExternalId}`,
    }));

    // Act
    const result = target.buildPlan(candidates, {
        targetListings: 80,
        minProductsPerShop: 20,
        maxProductsPerShop: 30,
        minShopsPerGroup: 1,
        maxShopsPerGroup: 1,
        uniqueCatalogProducts: true,
    });

    // Assert
    assert.equal(result.selectedListings.length, 80);
    assert.equal(result.selectedShops.length, 4);
    assert.deepEqual(Object.values(result.productsPerShop), [20, 20, 20, 20]);
});
