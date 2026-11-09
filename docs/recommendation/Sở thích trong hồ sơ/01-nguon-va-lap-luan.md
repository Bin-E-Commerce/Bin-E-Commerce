# 01. Nguồn và lập luận

Tài liệu này giải thích cơ sở của tiêu chí **Sở thích trong hồ sơ** (`profileAffinity`). Phạm vi chỉ là cách hồ sơ sản phẩm khớp với sở thích đã ghi nhận; không bao gồm tỷ trọng của tiêu chí trong điểm ranking tổng.

## 1. Công thức đã triển khai

Để bám sát mô hình time-aware và dễ chứng minh tính chất, tính decay trên từng sự kiện dương `e`:

$$
A_d(u,x,t)=\sum_{e\in E_d(u,x)}q_e\cdot 2^{-\frac{\Delta t_e}{H}},
\qquad \Delta t_e=\max(0,\text{số ngày từ }t_e\text{ đến }t),
\quad q_e\geq0,\;H>0.
$$

Chuẩn hóa từng chiều bằng ngưỡng có định nghĩa rõ `M_d > 0`:

$$
P_d=\min\left(1,\frac{A_d}{M_d}\right).
$$

Ghép ba chiều bằng tổng có trọng số:

$$
S=\lambda_pP_{product}+\lambda_cP_{category}+\lambda_bP_{brand},
\quad \lambda_p,\lambda_c,\lambda_b\geq0,
\quad \lambda_p+\lambda_c+\lambda_b=1.
$$

Mặc định hiện tại: `H = 7 ngày`, `M_product = 8`, `M_category = 16`, `M_brand = 8`, `(λ_p, λ_c, λ_b) = (0.5, 0.3, 0.2)`. Những số này là **giả thuyết nghiệp vụ**, không phải kết quả nghiên cứu hay tham số đã học từ khách hàng. Cấu hình cho phép thay đổi, nhưng đổi `H` cần tái dựng profile từ event gốc; đổi `M` hoặc `λ` không cần tái dựng.

Tín hiệu âm được cộng vào một tổng khác và dùng cho `negativePenalty`; nó không triệt tiêu tổng dương. Phần tính điểm nằm trong [`ranking-feature.service.ts`](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/features/ranking-feature.service.ts), còn phép cập nhật tổng theo thời gian nằm trong [`profile-projection.repository.ts`](../../../services/recommendation-service/src/modules/profiles/infrastructure/repositories/profile-projection.repository.ts).

### Vì sao aggregate vẫn đúng công thức từng event?

Hệ thống không phải đọc lại toàn bộ event mỗi khi xếp hạng. Với một mục, nó lưu tổng dương `A` đã giảm điểm tại mốc `T`. Khi nhận event mới `q` tại `t_e`, đặt `T' = max(T, t_e)` và cập nhật:

$$
A' = A\,2^{-(T'-T)/H} + q\,2^{-(T'-t_e)/H}.
$$

Do `2^{-(a+b)/H} = 2^{-a/H}2^{-b/H}`, quy nạp theo số event cho thấy `A'` đúng bằng tổng đóng góp của từng event tại `T'`, kể cả khi event đến không theo thứ tự thời gian. Khi đọc tại thời điểm `t ≥ T'`, nhân thêm `2^{-(t-T')/H}`. Tổng âm dùng cùng phép cập nhật với độ lớn `|q|`.

**Giới hạn chuyển đổi dữ liệu:** migration chỉ có `score` cũ và timestamp cuối, không thể suy ra timestamp của từng event đã mất. Nó khởi tạo gần đúng hai tổng dương/âm từ `score` cũ. Muốn công thức chính xác cho toàn bộ lịch sử phải replay event gốc, nếu log còn đủ. Các event mới sau migration được cập nhật đúng bằng recurrence trên phần dữ liệu đã lưu.

## 2. Chứng minh tính chất toán học

1. **Half-life:** `2^(-Δt/H) = 0.5^(Δt/H)`. Khi tuổi bằng `0`, trọng số bằng `1`; khi tuổi bằng `H`, trọng số bằng `0.5`.
2. **Tín hiệu cũ giảm dần:** với `H > 0`, đạo hàm theo tuổi là `-(ln 2/H) · 2^(-Δt/H) < 0`. Tuổi càng lớn thì đóng góp càng nhỏ.
3. **Điểm từng chiều có giới hạn:** vì `q_e ≥ 0`, `A_d ≥ 0`; với `M_d > 0`, `P_d = min(1,A_d/M_d)` nằm trong `[0,1]`.
4. **Điểm ghép có giới hạn:** `0 ≤ S ≤ λ_p + λ_c + λ_b = 1`, nên điểm cuối nằm trong `[0,1]` mà không cần clamp thêm.

Các lập luận này chứng minh công thức có các tính chất toán học trên. Chúng không chứng minh công thức sẽ tăng lượt mua hoặc tốt hơn một cách xếp hạng khác; việc đó cần đánh giá thực nghiệm ở file kế hoạch.

## 3. Nguồn nghiên cứu

- **Decay theo từng preference:** [Stefanidis et al., _A Framework for Time-aware Recommendations_ (DEXA 2012)](https://homepages.tuni.fi/konstantinos.stefanidis/docs/dexa12.pdf) gắn timestamp cho từng preference và dùng trọng số mũ `2^(-λ age)`. Đặt `λ = 1/H` cho dạng half-life ở trên. Nguồn này không xác nhận `H = 7` ngày cho dự án.
- **Half-life trong recommender system:** [Ardagelou & Arampatzis, _A Half-Life Decaying Model for Recommender Systems_](https://ceur-ws.org/Vol-2038/paper1.pdf) đánh giá half-life decay trên dữ liệu phim. Khoảng 150 ngày là kết quả trên bộ dữ liệu đó, không chuyển thẳng sang thương mại điện tử của dự án.
- **Tổng đặc trưng có trọng số:** [Debnath et al., WWW 2008, _Feature Weighting in Content Based Recommendation System Using Social Network Analysis_](https://cse.iitkgp.ac.in/~pabitra/paper/www08_recom.pdf) dùng tổ hợp tuyến tính đặc trưng và ước lượng trọng số từ dữ liệu. Bài báo không đưa ra trọng số sản phẩm/danh mục/thương hiệu cho dự án.
- **Ví dụ thương mại điện tử:** [_Recommendation Framework Combining User Interests with Fashion Trends in Apparel Online Shopping_ (2019)](https://www.mdpi.com/2076-3417/9/13/2634) kết hợp sở thích sản phẩm với nhu cầu theo danh mục và tinh chỉnh tham số trên dữ liệu nghiên cứu. Tham số đó không tự chứng minh hệ số trong dự án.

## Câu trả lời khi bảo vệ

> “Nghiên cứu hỗ trợ dạng decay half-life và tổng có trọng số. Em chứng minh được decay bằng 1 tại thời điểm phát sinh, còn một nửa sau một half-life, điểm từng chiều được chặn trong `[0,1]` và tổng có trọng số vẫn nằm trong `[0,1]`. Các tham số của đồ án là giả thuyết cần hiệu chỉnh và so sánh với baseline trên dữ liệu lịch sử; em không khẳng định chúng đúng phổ quát.”
