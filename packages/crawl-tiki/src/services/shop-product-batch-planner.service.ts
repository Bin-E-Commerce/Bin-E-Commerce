// Lập kế hoạch chọn listing theo quota shop và coverage mặt hàng.
// Planner không gọi Tiki, không ghi file và không import database; nó nhận candidate
// đã discover rồi trả về một plan deterministic để batch crawler thực thi/resume.

import type {
    ShopCandidate,
    ShopListingCandidate,
    ShopProductBatchPlan,
} from '../types/shop-product-batch.type';
import { buildCanonicalGroupKey } from '../utils/listing-key';

export interface ShopProductBatchPlannerOptions {
    targetListings: number;
    minProductsPerShop: number;
    maxProductsPerShop: number;
    minShopsPerGroup: number;
    maxShopsPerGroup: number;
    uniqueCatalogProducts?: boolean;
}

export class ShopProductBatchPlannerService {
    // Chọn một tập listing không trùng, ưu tiên group đủ seller và phân tải đều giữa các shop.
    // Mỗi group phải có tối thiểu minShopsPerGroup seller; mỗi group không vượt maxShopsPerGroup.
    // Planner trả shortfall thay vì âm thầm báo thành công nếu nguồn không đủ candidate hợp lệ.
    buildPlan(
        candidates: ShopListingCandidate[],
        options: ShopProductBatchPlannerOptions,
    ): ShopProductBatchPlan {
        this.validateOptions(options);

        const uniqueCandidates = this.resolveFallbackGroups(
            this.dedupeCandidates(
                candidates,
                options.uniqueCatalogProducts ?? false,
            ),
            options.minShopsPerGroup,
        );
        if (options.uniqueCatalogProducts) {
            return this.buildUniqueCatalogPlan(uniqueCandidates, options);
        }

        const byGroup = this.groupCandidates(uniqueCandidates);
        const eligibleGroups = [...byGroup.entries()]
            .filter(
                ([, listings]) =>
                    new Set(listings.map((listing) => listing.sellerExternalId))
                        .size >= options.minShopsPerGroup,
            )
            .sort(
                ([groupA, listingsA], [groupB, listingsB]) =>
                    this.sellerCount(listingsB) - this.sellerCount(listingsA) ||
                    groupA.localeCompare(groupB),
            );

        const selected = new Map<string, ShopListingCandidate>();
        const shopLoad = new Map<string, number>();
        const groupLoad = new Map<string, number>();

        // Vòng đầu tiên bảo đảm coverage 5–10 shop cho từng group trước khi lấp quota shop.
        for (const [, listings] of eligibleGroups) {
            const chosen = this.pickForGroup(
                listings,
                selected,
                shopLoad,
                options,
            );
            if (chosen.length < options.minShopsPerGroup) continue;

            for (const listing of chosen) {
                this.addListing(listing, selected, shopLoad, groupLoad);
            }

            if (selected.size >= options.targetListings) break;
        }

        // Vòng thứ hai đưa các shop đang được chọn lên tối thiểu 20 sản phẩm nhưng vẫn giữ group <= 10 shop.
        this.fillShopQuotas(
            uniqueCandidates,
            selected,
            shopLoad,
            groupLoad,
            options,
        );

        // Loại shop chưa đủ quota và group mất coverage, lặp tối đa vài vòng để trạng thái cuối ổn định.
        this.reconcileSelection(selected, shopLoad, groupLoad, options);

        const selectedListings = [...selected.values()].sort((left, right) =>
            left.listingKey.localeCompare(right.listingKey),
        );
        const productsPerShop = this.countBy(
            selectedListings,
            (listing) => listing.sellerExternalId,
        );
        const groupCoverage = this.countBy(
            selectedListings,
            (listing) => listing.canonicalGroupKey,
        );
        const selectedShops = this.buildSelectedShops(
            uniqueCandidates,
            selectedListings,
            productsPerShop,
            options,
        );

        return {
            selectedListings,
            selectedShops,
            eligibleGroups: eligibleGroups.length,
            groupCoverage,
            productsPerShop,
            shortfall: Math.max(
                0,
                options.targetListings - selectedListings.length,
            ),
        };
    }

    // Với batch không trùng catalog, chọn đủ quota từng shop trước rồi mới chuyển shop khác.
    // Nếu vẫn dùng vòng ưu tiên group cũ, nhiều shop chỉ có vài listing và bị reconcile loại hết.
    private buildUniqueCatalogPlan(
        candidates: ShopListingCandidate[],
        options: ShopProductBatchPlannerOptions,
    ): ShopProductBatchPlan {
        const bySeller = new Map<string, ShopListingCandidate[]>();
        for (const candidate of candidates) {
            const listings = bySeller.get(candidate.sellerExternalId) ?? [];
            listings.push(candidate);
            bySeller.set(candidate.sellerExternalId, listings);
        }

        const orderedShops = [...bySeller.entries()]
            .map(([sellerId, listings]) => [sellerId, listings] as const)
            .sort(
                ([leftSeller, leftListings], [rightSeller, rightListings]) =>
                    rightListings.length - leftListings.length ||
                    leftSeller.localeCompare(rightSeller),
            );
        const selected = new Map<string, ShopListingCandidate>();
        const shopLoad = new Map<string, number>();
        const groupLoad = new Map<string, number>();

        for (const [sellerId, listings] of orderedShops) {
            if (selected.size >= options.targetListings) break;

            const available: ShopListingCandidate[] = [];
            const localGroups = new Set<string>();
            for (const listing of [...listings].sort((left, right) =>
                left.listingKey.localeCompare(right.listingKey),
            )) {
                if (
                    localGroups.has(listing.canonicalGroupKey) ||
                    (groupLoad.get(listing.canonicalGroupKey) ?? 0) >=
                        options.maxShopsPerGroup
                ) {
                    continue;
                }
                localGroups.add(listing.canonicalGroupKey);
                available.push(listing);
            }
            if (available.length < options.minProductsPerShop) continue;

            // Mỗi shop phải đạt ngưỡng tối thiểu trước khi được đưa vào batch.
            const quota = Math.min(
                options.maxProductsPerShop,
                Math.max(
                    options.minProductsPerShop,
                    options.targetListings - selected.size,
                ),
            );
            for (const listing of available.slice(0, quota)) {
                this.addListing(listing, selected, shopLoad, groupLoad);
            }
        }

        const selectedListings = [...selected.values()].sort((left, right) =>
            left.listingKey.localeCompare(right.listingKey),
        );
        const productsPerShop = this.countBy(
            selectedListings,
            (listing) => listing.sellerExternalId,
        );
        const groupCoverage = this.countBy(
            selectedListings,
            (listing) => listing.canonicalGroupKey,
        );
        const eligibleGroups = new Set(
            candidates.map((listing) => listing.canonicalGroupKey),
        ).size;

        return {
            selectedListings,
            selectedShops: this.buildSelectedShops(
                candidates,
                selectedListings,
                productsPerShop,
                options,
            ),
            eligibleGroups,
            groupCoverage,
            productsPerShop,
            shortfall: Math.max(
                0,
                options.targetListings - selectedListings.length,
            ),
        };
    }

    // Loại listing trùng do một product xuất hiện ở nhiều category/page, giữ bản ghi đầu tiên ổn định.
    private dedupeCandidates(
        candidates: ShopListingCandidate[],
        uniqueCatalogProducts: boolean,
    ): ShopListingCandidate[] {
        const unique = new Map<string, ShopListingCandidate>();
        for (const candidate of candidates) {
            const dedupeKey = uniqueCatalogProducts
                ? candidate.catalogExternalId
                : candidate.listingKey;
            if (!unique.has(dedupeKey)) {
                unique.set(dedupeKey, candidate);
            }
        }
        return [...unique.values()];
    }

    // Nếu Tiki tạo nhiều catalog ID cho cùng tên/brand/category, dùng khóa text exact làm fallback
    // nhưng chỉ khi group product ID riêng lẻ chưa đủ seller; cách này tránh fuzzy merge sản phẩm khác nhau.
    private resolveFallbackGroups(
        candidates: ShopListingCandidate[],
        minShopsPerGroup: number,
    ): ShopListingCandidate[] {
        const primarySellerCounts = new Map<string, Set<string>>();
        const fallbackSellerCounts = new Map<string, Set<string>>();

        for (const candidate of candidates) {
            const primarySellers =
                primarySellerCounts.get(candidate.canonicalGroupKey) ??
                new Set<string>();
            primarySellers.add(candidate.sellerExternalId);
            primarySellerCounts.set(
                candidate.canonicalGroupKey,
                primarySellers,
            );

            const fallbackKey = this.buildFallbackGroupKey(candidate);
            const fallbackSellers =
                fallbackSellerCounts.get(fallbackKey) ?? new Set<string>();
            fallbackSellers.add(candidate.sellerExternalId);
            fallbackSellerCounts.set(fallbackKey, fallbackSellers);
        }

        return candidates.map((candidate) => {
            if (
                (primarySellerCounts.get(candidate.canonicalGroupKey)?.size ??
                    0) >= minShopsPerGroup
            ) {
                return candidate;
            }

            const fallbackKey = this.buildFallbackGroupKey(candidate);
            if (
                (fallbackSellerCounts.get(fallbackKey)?.size ?? 0) <
                minShopsPerGroup
            ) {
                return candidate;
            }

            return { ...candidate, canonicalGroupKey: fallbackKey };
        });
    }

    // Tạo fallback exact theo brand, tên và category; không bỏ dấu nhưng cũng không dùng similarity threshold.
    private buildFallbackGroupKey(candidate: ShopListingCandidate): string {
        return buildCanonicalGroupKey({
            catalogExternalId: undefined,
            brandName: candidate.brandName,
            name: candidate.productName,
            categoryName: candidate.categoryName,
        });
    }

    // Gom candidate theo canonical group để đo coverage seller trước khi chọn listing.
    private groupCandidates(
        candidates: ShopListingCandidate[],
    ): Map<string, ShopListingCandidate[]> {
        const groups = new Map<string, ShopListingCandidate[]>();
        for (const candidate of candidates) {
            const current = groups.get(candidate.canonicalGroupKey) ?? [];
            current.push(candidate);
            groups.set(candidate.canonicalGroupKey, current);
        }
        return groups;
    }

    // Chọn seller ít tải nhất cho group để coverage không dồn vào một vài shop.
    private pickForGroup(
        listings: ShopListingCandidate[],
        selected: Map<string, ShopListingCandidate>,
        shopLoad: Map<string, number>,
        options: ShopProductBatchPlannerOptions,
    ): ShopListingCandidate[] {
        const bySeller = new Map<string, ShopListingCandidate>();
        for (const listing of listings) {
            if (!bySeller.has(listing.sellerExternalId)) {
                bySeller.set(listing.sellerExternalId, listing);
            }
        }

        return [...bySeller.values()]
            .sort(
                (left, right) =>
                    (shopLoad.get(left.sellerExternalId) ?? 0) -
                        (shopLoad.get(right.sellerExternalId) ?? 0) ||
                    left.sellerExternalId.localeCompare(right.sellerExternalId),
            )
            .filter(
                (listing) =>
                    !selected.has(listing.listingKey) &&
                    (shopLoad.get(listing.sellerExternalId) ?? 0) <
                        options.maxProductsPerShop,
            )
            .slice(0, options.maxShopsPerGroup);
    }

    // Bổ sung listing cho shop còn thiếu quota, không vượt target hoặc coverage group tối đa.
    private fillShopQuotas(
        candidates: ShopListingCandidate[],
        selected: Map<string, ShopListingCandidate>,
        shopLoad: Map<string, number>,
        groupLoad: Map<string, number>,
        options: ShopProductBatchPlannerOptions,
    ): void {
        const bySeller = new Map<string, ShopListingCandidate[]>();
        for (const candidate of candidates) {
            const current = bySeller.get(candidate.sellerExternalId) ?? [];
            current.push(candidate);
            bySeller.set(candidate.sellerExternalId, current);
        }

        const sellers = [...bySeller.keys()].sort(
            (left, right) =>
                (shopLoad.get(left) ?? 0) - (shopLoad.get(right) ?? 0) ||
                left.localeCompare(right),
        );

        for (const sellerId of sellers) {
            const sellerListings = bySeller.get(sellerId) ?? [];
            const ordered = sellerListings.sort(
                (left, right) =>
                    (groupLoad.get(left.canonicalGroupKey) ?? 0) -
                        (groupLoad.get(right.canonicalGroupKey) ?? 0) ||
                    left.listingKey.localeCompare(right.listingKey),
            );

            for (const listing of ordered) {
                if (selected.size >= options.targetListings) return;
                if (
                    (shopLoad.get(sellerId) ?? 0) >= options.maxProductsPerShop
                ) {
                    break;
                }
                if (selected.has(listing.listingKey)) continue;
                if (
                    (groupLoad.get(listing.canonicalGroupKey) ?? 0) >=
                    options.maxShopsPerGroup
                ) {
                    continue;
                }

                this.addListing(listing, selected, shopLoad, groupLoad);
            }
        }
    }

    // Lặp lại việc loại shop/group không đạt ngưỡng để output cuối không chứa coverage giả.
    private reconcileSelection(
        selected: Map<string, ShopListingCandidate>,
        shopLoad: Map<string, number>,
        groupLoad: Map<string, number>,
        options: ShopProductBatchPlannerOptions,
    ): void {
        for (let pass = 0; pass < 3; pass += 1) {
            const invalidShops = new Set(
                [...shopLoad.entries()]
                    .filter(([, count]) => count < options.minProductsPerShop)
                    .map(([sellerId]) => sellerId),
            );
            const invalidGroups = new Set(
                [...groupLoad.entries()]
                    .filter(([, count]) => count < options.minShopsPerGroup)
                    .map(([groupKey]) => groupKey),
            );

            if (invalidShops.size === 0 && invalidGroups.size === 0) return;

            for (const [listingKey, listing] of selected) {
                if (
                    invalidShops.has(listing.sellerExternalId) ||
                    invalidGroups.has(listing.canonicalGroupKey)
                ) {
                    selected.delete(listingKey);
                    this.decrement(shopLoad, listing.sellerExternalId);
                    this.decrement(groupLoad, listing.canonicalGroupKey);
                }
            }
        }
    }

    // Tạo danh sách shop kèm đúng các listing đã chọn để writer ghi staging và manifest.
    private buildSelectedShops(
        candidates: ShopListingCandidate[],
        selectedListings: ShopListingCandidate[],
        productsPerShop: Record<string, number>,
        options: ShopProductBatchPlannerOptions,
    ): ShopCandidate[] {
        const shopInfo = new Map<string, ShopCandidate>();
        for (const candidate of candidates) {
            if (!shopInfo.has(candidate.sellerExternalId)) {
                shopInfo.set(candidate.sellerExternalId, {
                    sellerExternalId: candidate.sellerExternalId,
                    sellerName:
                        candidate.sellerName ??
                        `Tiki seller ${candidate.sellerExternalId}`,
                    sourceUrl: null,
                    listings: [],
                });
            }
        }

        for (const listing of selectedListings) {
            const shop = shopInfo.get(listing.sellerExternalId);
            if (shop) shop.listings.push(listing);
        }

        return [...shopInfo.values()]
            .filter(
                (shop) =>
                    (productsPerShop[shop.sellerExternalId] ?? 0) >=
                    options.minProductsPerShop,
            )
            .sort((left, right) =>
                left.sellerExternalId.localeCompare(right.sellerExternalId),
            );
    }

    // Cập nhật đồng thời selection và hai bộ đếm quota để mọi quyết định sau đó dùng cùng trạng thái.
    private addListing(
        listing: ShopListingCandidate,
        selected: Map<string, ShopListingCandidate>,
        shopLoad: Map<string, number>,
        groupLoad: Map<string, number>,
    ): void {
        selected.set(listing.listingKey, listing);
        shopLoad.set(
            listing.sellerExternalId,
            (shopLoad.get(listing.sellerExternalId) ?? 0) + 1,
        );
        groupLoad.set(
            listing.canonicalGroupKey,
            (groupLoad.get(listing.canonicalGroupKey) ?? 0) + 1,
        );
    }

    // Giảm bộ đếm khi reconcile xóa listing khỏi plan.
    private decrement(counter: Map<string, number>, key: string): void {
        const next = (counter.get(key) ?? 0) - 1;
        if (next <= 0) counter.delete(key);
        else counter.set(key, next);
    }

    // Đếm số listing theo một thuộc tính để tạo manifest và kiểm tra quota.
    private countBy(
        listings: ShopListingCandidate[],
        selector: (listing: ShopListingCandidate) => string,
    ): Record<string, number> {
        const counts: Record<string, number> = {};
        for (const listing of listings) {
            const key = selector(listing);
            counts[key] = (counts[key] ?? 0) + 1;
        }
        return counts;
    }

    // Lấy số seller khác nhau trong một group để kiểm tra điều kiện coverage trước khi chọn.
    private sellerCount(listings: ShopListingCandidate[]): number {
        return new Set(listings.map((listing) => listing.sellerExternalId))
            .size;
    }

    // Chặn cấu hình quota vô nghĩa trước khi planner tạo ra plan không thể nghiệm thu.
    private validateOptions(options: ShopProductBatchPlannerOptions): void {
        if (options.targetListings <= 0) {
            throw new Error('targetListings must be greater than zero');
        }
        if (
            options.minProductsPerShop <= 0 ||
            options.maxProductsPerShop < options.minProductsPerShop
        ) {
            throw new Error('invalid products-per-shop quota');
        }
        if (
            options.minShopsPerGroup <= 0 ||
            options.maxShopsPerGroup < options.minShopsPerGroup
        ) {
            throw new Error('invalid shops-per-group quota');
        }
    }
}
