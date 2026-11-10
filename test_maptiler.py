import os
import sys

import requests
from dotenv import load_dotenv

load_dotenv()
API_KEY = os.getenv('MAPTILER_API_KEY') or os.getenv('MAPTILER_KEY')
DEFAULT_ADDRESS = 'TT02-1 và TT02-2, KĐT mới Phú Lương, phường Kiến Hưng, Hà Nội'


def geocode(address: str):
    if not API_KEY:
        raise RuntimeError('Thiếu MAPTILER_API_KEY (hoặc MAPTILER_KEY) trong .env')
    url = f'https://api.maptiler.com/geocoding/{requests.utils.quote(address, safe="")}.json'
    response = requests.get(url, params={
        'key': API_KEY,
        'country': 'vn',
        'limit': 1,
        'autocomplete': 'false',
        'language': 'vi',
    }, timeout=20)
    response.raise_for_status()
    return response.json().get('features', [])


def main():
    address = ' '.join(sys.argv[1:]).strip() or DEFAULT_ADDRESS
    print(f'Địa chỉ tìm kiếm: {address}\n')
    try:
        features = geocode(address)
    except requests.RequestException as exc:
        print(f'Lỗi gọi MapTiler API: {exc}')
        sys.exit(1)
    except RuntimeError as exc:
        print(exc)
        sys.exit(1)
    if not features:
        print('Không tìm thấy kết quả. Hãy thử địa chỉ ngắn hơn.')
        return
    for i, item in enumerate(features, 1):
        center = item.get('center') or item.get('geometry', {}).get('coordinates')
        print(f'--- Kết quả {i} ---')
        print('Tên:', item.get('place_name', item.get('text', 'Không rõ')))
        print('Loại:', ', '.join(item.get('place_type', [])))
        if center and len(center) >= 2:
            print('Kinh độ (lng):', center[0])
            print('Vĩ độ (lat):', center[1])
        else:
            print('Không có tọa độ')
        print()
    print('Lưu ý: kết quả có thể là tâm đường/phường, không phải vị trí chính xác của cơ sở.')


if __name__ == '__main__':
    main()
