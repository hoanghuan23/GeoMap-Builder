// Thêm ánh xạ quốc gia dự phòng tại đây khi có dữ liệu tương ứng.
// URL tường minh giúp Vite chỉ đóng gói các quốc gia đã cấu hình.
export const COUNTRY_BOUNDARY_SOURCES = {
  VNM: {
    name: "Việt Nam",
    aliases: ["Việt Nam", "Viet Nam", "Vietnam", "VN", "VNM"],
    nameAliases: {
      1: { "ThừaThiênHuế": ["Huế"], "HồChíMinh": ["TP HCM", "Ho Chi Minh City"] }
    },
    files: {
      0: new URL("../administrative_division/VNM/VNM_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/VNM/VNM_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/VNM/VNM_ADM2.geojson", import.meta.url)
    }
  },
  RUS: {
    name: "Nga",
    aliases: ["Nga", "Liên bang Nga", "Lien bang Nga", "Russia", "Russian Federation", "RU", "RUS"],
    files: {
      0: new URL("../administrative_division/RUS/RUS_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/RUS/RUS_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/RUS/RUS_ADM2.geojson", import.meta.url),
      3: new URL("../administrative_division/RUS/RUS_ADM3.geojson", import.meta.url)
    }
  },
  USA: {
    name: "Hoa Kỳ",
    aliases: ["Mỹ", "Hoa Kỳ (Mỹ)", "United States", "United States of America", "US"],
    files: {
      0: new URL("../administrative_division/USA/USA_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/USA/USA_ADM0.geojson", import.meta.url),
      2: new URL("../administrative_division/USA/USA_ADM0.geojson", import.meta.url),
    }
  },
  AUT: {
    name: "Áo",
    aliases: ["Austria", "AT"],
    files: {
      0: new URL("../administrative_division/AUT/AUT_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/AUT/AUT_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/AUT/AUT_ADM2.geojson", import.meta.url),
      3: new URL("../administrative_division/AUT/AUT_ADM3.geojson", import.meta.url),
      4: new URL("../administrative_division/AUT/AUT_ADM4.geojson", import.meta.url)
    }
  },
  AUS: {
    name: "Úc",
    aliases: ["Úc (Australia)", "Australia", "AU"],
    files: {
      0: new URL("../administrative_division/AUS/AUS_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/AUS/AUS_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/AUS/AUS_ADM2.geojson", import.meta.url)
    }
  },
  JPN: {
    name: "Nhật Bản",
    aliases: ["Nhật", "Japan", "JP"],
    files: {
      0: new URL("../administrative_division/JPN/JPN_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/JPN/JPN_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/JPN/JPN_ADM2.geojson", import.meta.url)
    }
  },
  KOR: {
    name: "Hàn Quốc",
    aliases: ["Nam Triều Tiên", "South Korea", "Republic of Korea", "KR"],
    files: {
      0: new URL("../administrative_division/KOR/KOR_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/KOR/KOR_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/KOR/KOR_ADM2.geojson", import.meta.url),
      3: new URL("../administrative_division/KOR/KOR_ADM3.geojson", import.meta.url)
    }
  },
  PRK: {
    name: "Triều Tiên",
    aliases: ["Bắc Triều Tiên", "Triều Tiên (Bắc Triều Tiên)", "North Korea", "KP"],
    files: {
      0: new URL("../administrative_division/PRK/PRK_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/PRK/PRK_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/PRK/PRK_ADM2.geojson", import.meta.url)
    }
  },
  SWE: {
    name: "Thụy Điển",
    aliases: ["Sweden", "SE"],
    files: {
      0: new URL("../administrative_division/SWE/SWE_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/SWE/SWE_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/SWE/SWE_ADM2.geojson", import.meta.url)
    }
  },
  FRA: {
    name: "Pháp",
    aliases: ["France", "FR"],
    files: {
      0: new URL("../administrative_division/FRA/FRA_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/FRA/FRA_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/FRA/FRA_ADM2.geojson", import.meta.url),
      3: new URL("../administrative_division/FRA/FRA_ADM3.geojson", import.meta.url),
      4: new URL("../administrative_division/FRA/FRA_ADM4.geojson", import.meta.url),
      5: new URL("../administrative_division/FRA/FRA_ADM5.geojson", import.meta.url)
    }
  },
  IND: {
    name: "Ấn Độ",
    aliases: ["India", "IN"],
    files: {
      0: new URL("../administrative_division/IND/IND_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/IND/IND_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/IND/IND_ADM2.geojson", import.meta.url),
      3: new URL("../administrative_division/IND/IND_ADM3.geojson", import.meta.url)
    }
  },
  TWN: {
    name: "Đài Loan",
    aliases: ["Taiwan", "TW"],
    files: {
      0: new URL("../administrative_division/TWN/TWN_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/TWN/TWN_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/TWN/TWN_ADM2.geojson", import.meta.url)
    }
  },
  ITA: {
    name: "Ý",
    aliases: ["Ý (Italia)", "Italia", "Italy", "IT"],
    files: {
      0: new URL("../administrative_division/ITA/ITA_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/ITA/ITA_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/ITA/ITA_ADM2.geojson", import.meta.url),
      3: new URL("../administrative_division/ITA/ITA_ADM3.geojson", import.meta.url)
    }
  },
  LAO: {
    name: "Lào",
    aliases: ["Laos", "LA"],
    files: {
      0: new URL("../administrative_division/LAO/LAO_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/LAO/LAO_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/LAO/LAO_ADM2.geojson", import.meta.url)
    }
  },
  CHN: {
    name: "Trung Quốc",
    aliases: ["China", "CN"],
    files: {
      0: new URL("../administrative_division/CHN/CHN_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/CHN/CHN_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/CHN/CHN_ADM2.geojson", import.meta.url),
      3: new URL("../administrative_division/CHN/CHN_ADM3.geojson", import.meta.url)
    }
  },
  GBR: {
    name: "Anh",
    aliases: ["Anh (Vương quốc Anh)", "Vương quốc Anh", "United Kingdom", "Great Britain", "Britain", "UK", "GB"],
    files: {
      0: new URL("../administrative_division/GBR/GBR_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/GBR/GBR_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/GBR/GBR_ADM2.geojson", import.meta.url),
      3: new URL("../administrative_division/GBR/GBR_ADM3.geojson", import.meta.url),
      4: new URL("../administrative_division/GBR/GBR_ADM4.geojson", import.meta.url)
    }
  },
  DEU: {
    name: "Đức",
    aliases: ["Germany", "DE"],
    files: {
      0: new URL("../administrative_division/DEU/DEU_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/DEU/DEU_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/DEU/DEU_ADM2.geojson", import.meta.url),
      3: new URL("../administrative_division/DEU/DEU_ADM3.geojson", import.meta.url),
      4: new URL("../administrative_division/DEU/DEU_ADM4.geojson", import.meta.url)
    }
  },
  CAN: {
    name: "Canada",
    aliases: ["CA"],
    files: {
      0: new URL("../administrative_division/CAN/CAN_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/CAN/CAN_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/CAN/CAN_ADM2.geojson", import.meta.url),
      3: new URL("../administrative_division/CAN/CAN_ADM3.geojson", import.meta.url)
    }
  },
  BRA: {
    name: "Brazil",
    aliases: ["Brasil", "Bra-xin", "BR"],
    files: {
      0: new URL("../administrative_division/BRA/BRA_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/BRA/BRA_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/BRA/BRA_ADM2.geojson", import.meta.url)
    }
  },
  ESP: {
    name: "Tây Ban Nha",
    aliases: ["Spain", "ES"],
    files: {
      0: new URL("../administrative_division/ESP/ESP_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/ESP/ESP_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/ESP/ESP_ADM2.geojson", import.meta.url),
      3: new URL("../administrative_division/ESP/ESP_ADM3.geojson", import.meta.url),
      4: new URL("../administrative_division/ESP/ESP_ADM4.geojson", import.meta.url)
    }
  },
  CHE: {
    name: "Thụy Sĩ",
    aliases: ["Switzerland", "CH"],
    files: {
      0: new URL("../administrative_division/CHE/CHE_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/CHE/CHE_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/CHE/CHE_ADM2.geojson", import.meta.url),
      3: new URL("../administrative_division/CHE/CHE_ADM3.geojson", import.meta.url)
    }
  },
  NLD: {
    name: "Hà Lan",
    aliases: ["Netherlands", "Holland", "NL"],
    files: {
      0: new URL("../administrative_division/NLD/NLD_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/NLD/NLD_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/NLD/NLD_ADM2.geojson", import.meta.url)
    }
  },
  BEL: {
    name: "Bỉ",
    aliases: ["Belgium", "BE"],
    files: {
      0: new URL("../administrative_division/BEL/BEL_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/BEL/BEL_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/BEL/BEL_ADM2.geojson", import.meta.url),
      3: new URL("../administrative_division/BEL/BEL_ADM3.geojson", import.meta.url),
      4: new URL("../administrative_division/BEL/BEL_ADM4.geojson", import.meta.url)
    }
  },
  NOR: {
    name: "Na Uy",
    aliases: ["Norway", "NO"],
    files: {
      0: new URL("../administrative_division/NOR/NOR_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/NOR/NOR_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/NOR/NOR_ADM2.geojson", import.meta.url)
    }
  },
  DNK: {
    name: "Đan Mạch",
    aliases: ["Denmark", "DK"],
    files: {
      0: new URL("../administrative_division/DNK/DNK_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/DNK/DNK_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/DNK/DNK_ADM2.geojson", import.meta.url)
    }
  },
  FIN: {
    name: "Phần Lan",
    aliases: ["Finland", "FI"],
    files: {
      0: new URL("../administrative_division/FIN/FIN_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/FIN/FIN_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/FIN/FIN_ADM2.geojson", import.meta.url),
      3: new URL("../administrative_division/FIN/FIN_ADM3.geojson", import.meta.url),
      4: new URL("../administrative_division/FIN/FIN_ADM4.geojson", import.meta.url)
    }
  },
  POL: {
    name: "Ba Lan",
    aliases: ["Poland", "PL"],
    files: {
      0: new URL("../administrative_division/POL/POL_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/POL/POL_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/POL/POL_ADM2.geojson", import.meta.url),
      3: new URL("../administrative_division/POL/POL_ADM3.geojson", import.meta.url)
    }
  },
  UKR: {
    name: "Ukraine",
    aliases: ["Ukraina", "U-crai-na", "UA"],
    files: {
      0: new URL("../administrative_division/UKR/UKR_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/UKR/UKR_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/UKR/UKR_ADM2.geojson", import.meta.url)
    }
  },
  TUR: {
    name: "Thổ Nhĩ Kỳ",
    aliases: ["Turkey", "Türkiye", "TR"],
    files: {
      0: new URL("../administrative_division/TUR/TUR_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/TUR/TUR_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/TUR/TUR_ADM2.geojson", import.meta.url)
    }
  },
  SGP: {
    name: "Singapore",
    aliases: ["Xin-ga-po", "SG"],
    cityState: true,
    files: {
      0: new URL("../administrative_division/SGP/SGP_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/SGP/SGP_ADM1.geojson", import.meta.url)
    }
  },
  THA: {
    name: "Thái Lan",
    aliases: ["Thailand", "TH"],
    files: {
      0: new URL("../administrative_division/THA/THA_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/THA/THA_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/THA/THA_ADM2.geojson", import.meta.url),
      3: new URL("../administrative_division/THA/THA_ADM3.geojson", import.meta.url)
    }
  },
  MYS: {
    name: "Malaysia",
    aliases: ["Mã Lai", "MY"],
    files: {
      0: new URL("../administrative_division/MYS/MYS_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/MYS/MYS_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/MYS/MYS_ADM2.geojson", import.meta.url)
    }
  },
  IDN: {
    name: "Indonesia",
    aliases: ["In-đô-nê-xi-a", "ID"],
    files: {
      0: new URL("../administrative_division/IDN/IDN_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/IDN/IDN_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/IDN/IDN_ADM2.geojson", import.meta.url),
      3: new URL("../administrative_division/IDN/IDN_ADM3.geojson", import.meta.url),
      4: new URL("../administrative_division/IDN/IDN_ADM4.geojson", import.meta.url)
    }
  },
  PHL: {
    name: "Philippines",
    aliases: ["Philippine", "Phi-líp-pin", "PH"],
    files: {
      0: new URL("../administrative_division/PHL/PHL_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/PHL/PHL_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/PHL/PHL_ADM2.geojson", import.meta.url),
      3: new URL("../administrative_division/PHL/PHL_ADM3.geojson", import.meta.url)
    }
  },
  BRN: {
    name: "Brunei",
    aliases: ["Brunei Darussalam", "BN"],
    files: {
      0: new URL("../administrative_division/BRN/BRN_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/BRN/BRN_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/BRN/BRN_ADM2.geojson", import.meta.url)
    }
  },
  TLS: {
    name: "Timor-Leste",
    aliases: ["Timor Leste", "East Timor", "Đông Timor", "TL"],
    files: {
      0: new URL("../administrative_division/TLS/TLS_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/TLS/TLS_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/TLS/TLS_ADM2.geojson", import.meta.url),
      3: new URL("../administrative_division/TLS/TLS_ADM3.geojson", import.meta.url)
    }
  },
  KHM: {
    name: "Campuchia",
    aliases: ["Cambodia", "Cam-pu-chia", "KH"],
    files: {
      0: new URL("../administrative_division/KHM/KHM_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/KHM/KHM_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/KHM/KHM_ADM2.geojson", import.meta.url),
      3: new URL("../administrative_division/KHM/KHM_ADM3.geojson", import.meta.url)
    }
  },
  MMR: {
    name: "Myanmar",
    aliases: ["Myanmar (Burma)", "Burma", "Miến Điện", "MM"],
    files: {
      0: new URL("../administrative_division/MMR/MMR_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/MMR/MMR_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/MMR/MMR_ADM2.geojson", import.meta.url),
      3: new URL("../administrative_division/MMR/MMR_ADM3.geojson", import.meta.url)
    }
  },
  NZL: {
    name: "New Zealand",
    aliases: ["Niu Di-lân", "NZ"],
    files: {
      0: new URL("../administrative_division/NZL/NZL_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/NZL/NZL_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/NZL/NZL_ADM2.geojson", import.meta.url)
    }
  },
  MEX: {
    name: "Mexico",
    aliases: ["México", "Mê-hi-cô", "MX"],
    files: {
      0: new URL("../administrative_division/MEX/MEX_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/MEX/MEX_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/MEX/MEX_ADM2.geojson", import.meta.url)
    }
  },
  ARG: {
    name: "Argentina",
    aliases: ["Ác-hen-ti-na", "AR"],
    files: {
      0: new URL("../administrative_division/ARG/ARG_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/ARG/ARG_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/ARG/ARG_ADM2.geojson", import.meta.url)
    }
  },
  ZAF: {
    name: "Nam Phi",
    aliases: ["South Africa", "ZA"],
    files: {
      0: new URL("../administrative_division/ZAF/ZAF_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/ZAF/ZAF_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/ZAF/ZAF_ADM2.geojson", import.meta.url),
      3: new URL("../administrative_division/ZAF/ZAF_ADM3.geojson", import.meta.url),
      4: new URL("../administrative_division/ZAF/ZAF_ADM4.geojson", import.meta.url)
    }
  },
  EGY: {
    name: "Ai Cập",
    aliases: ["Egypt", "EG"],
    files: {
      0: new URL("../administrative_division/EGY/EGY_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/EGY/EGY_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/EGY/EGY_ADM2.geojson", import.meta.url)
    }
  },
  SAU: {
    name: "Ả Rập Xê Út",
    aliases: ["Saudi Arabia", "Saudi", "SA"],
    files: {
      0: new URL("../administrative_division/SAU/SAU_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/SAU/SAU_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/SAU/SAU_ADM2.geojson", import.meta.url)
    }
  },
  ARE: {
    name: "UAE",
    aliases: ["UAE (Các Tiểu vương quốc Ả Rập Thống nhất)", "Các Tiểu vương quốc Ả Rập Thống nhất", "United Arab Emirates", "AE"],
    files: {
      0: new URL("../administrative_division/ARE/ARE_ADM0.geojson", import.meta.url),
      1: new URL("../administrative_division/ARE/ARE_ADM1.geojson", import.meta.url),
      2: new URL("../administrative_division/ARE/ARE_ADM2.geojson", import.meta.url),
      3: new URL("../administrative_division/ARE/ARE_ADM3.geojson", import.meta.url)
    }
  }
};
