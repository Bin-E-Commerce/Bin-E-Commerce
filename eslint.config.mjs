import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

// Cấu hình lint dùng chung cho TypeScript backend và packages trong monorepo.
// Các service trước đây gọi ESLint nhưng không có config nên ESLint 10 dừng ngay
// trước khi phân tích source. Config này giữ lint độc lập với runtime Secret và
// chỉ áp dụng parser/rules phù hợp cho source TypeScript.
export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**", "web/**"],
  },
  {
    files: ["services/**/*.ts", "packages/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // Bật các cảnh báo nền tảng nhưng không biến code legacy thành lỗi build.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];
