#include "beatcut/image.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <vector>

#define STB_IMAGE_IMPLEMENTATION
#define STBI_ONLY_JPEG
#define STBI_ONLY_PNG
#define STBI_ONLY_BMP
#include "stb_image.h"

namespace beatcut {

VisualFeatures analyze_rgb(const unsigned char* rgb, int w, int h) {
    VisualFeatures f;
    if (!rgb || w <= 0 || h <= 0) return f;
    const int n = w * h;
    double sumY = 0, sumY2 = 0, sumR = 0, sumB = 0, sumSat = 0, sumGrad = 0;
    auto Y = [&](int i) {
        const int o = i * 3;
        return 0.2126 * rgb[o] + 0.7152 * rgb[o + 1] + 0.0722 * rgb[o + 2];
    };
    for (int i = 0; i < n; ++i) {
        const int o = i * 3;
        const double r = rgb[o] / 255.0;
        const double g = rgb[o + 1] / 255.0;
        const double b = rgb[o + 2] / 255.0;
        const double y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        sumY += y;
        sumY2 += y * y;
        sumR += r;
        sumB += b;
        const double mx = std::max({r, g, b});
        const double mn = std::min({r, g, b});
        sumSat += (mx > 1e-6) ? (mx - mn) / mx : 0;
    }
    const double meanY = sumY / n;
    const double var = std::max(0.0, sumY2 / n - meanY * meanY);
    const double contrast = std::clamp(std::sqrt(var) / 0.35, 0.0, 1.0);
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            const int i = y * w + x;
            const double yy = Y(i) / 255.0;
            if (x + 1 < w) sumGrad += std::fabs(Y(i + 1) / 255.0 - yy);
            if (y + 1 < h) sumGrad += std::fabs(Y(i + w) / 255.0 - yy);
        }
    }
    const double sharpness = std::clamp(sumGrad / (2.0 * n) / 0.25, 0.0, 1.0);
    f.brightness = meanY;
    f.contrast = contrast;
    f.saturation = sumSat / n;
    f.warmth = std::clamp(((sumR / n - sumB / n) + 0.25) / 0.5, 0.0, 1.0);
    f.sharpness = sharpness;
    f.energy = std::clamp(0.35 * f.contrast + 0.35 * f.saturation + 0.20 * f.sharpness +
                              0.10 * std::fabs(f.brightness - 0.5) * 2.0,
                          0.0, 1.0);
    return f;
}

VisualFeatures analyze_image_file(const std::string& path) {
    int w = 0, h = 0, c = 0;
    unsigned char* data = stbi_load(path.c_str(), &w, &h, &c, 3);
    if (!data) throw std::runtime_error(std::string("cannot load image: ") + path);
    // thumbnail-ish: if huge, we still scan all pixels; fine for fixtures
    VisualFeatures f = analyze_rgb(data, w, h);
    stbi_image_free(data);
    return f;
}

}  // namespace beatcut
