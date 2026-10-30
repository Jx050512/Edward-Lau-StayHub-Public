'use strict';
// Actual, location-identified travel photographs from Wikimedia Commons; see docs/PHOTO_CREDITS.md.
const STAYHUB_SCENES = [
  {
    "name": "Langkawi",
    "tag": "Kedah · Islands & beaches",
    "image": "https://commons.wikimedia.org/wiki/Special:FilePath/Sunset%20Beach%20Lankawi.JPG?width=1500",
    "credit": "David Block",
    "license": "CC BY-SA 2.5",
    "source": "https://commons.wikimedia.org/wiki/File:Sunset_Beach_Lankawi.JPG"
  },
  {
    "name": "Kuala Lumpur",
    "tag": "City lights & culture",
    "image": "https://commons.wikimedia.org/wiki/Special:FilePath/Kuala%20Lumpur%20skyline%20and%20Petronas%20Twin%20Towers%20night%20view%20from%20Kampung%20Baru.jpg%2001.jpg?width=1500",
    "credit": "ELIZABETH XIONG",
    "license": "CC BY 4.0",
    "source": "https://commons.wikimedia.org/wiki/File:Kuala_Lumpur_skyline_and_Petronas_Twin_Towers_night_view_from_Kampung_Baru.jpg_01.jpg"
  },
  {
    "name": "George Town",
    "tag": "Penang · Heritage city",
    "image": "https://commons.wikimedia.org/wiki/Special:FilePath/George%20Town%2C%20Penang%20city%20centre.jpg?width=1500",
    "credit": "HundenvonPenang",
    "license": "CC BY-SA 4.0",
    "source": "https://commons.wikimedia.org/wiki/File:George_Town%2C_Penang_city_centre.jpg"
  },
  {
    "name": "Kota Kinabalu",
    "tag": "Sabah · The coast",
    "image": "https://commons.wikimedia.org/wiki/Special:FilePath/Kota%20Kinabalu%20waterfront%2C%202024%20%2801%29.jpg?width=1500",
    "credit": "Bahnfrend",
    "license": "CC BY-SA 4.0",
    "source": "https://commons.wikimedia.org/wiki/File:Kota_Kinabalu_waterfront%2C_2024_%2801%29.jpg"
  },
  {
    "name": "Kuching",
    "tag": "Sarawak · Waterfront city",
    "image": "https://commons.wikimedia.org/wiki/Special:FilePath/Waterfront%20Kuching%20view.jpg?width=1500",
    "credit": "Jjurieee",
    "license": "CC BY-SA 4.0",
    "source": "https://commons.wikimedia.org/wiki/File:Waterfront_Kuching_view.jpg"
  },
  {
    "name": "Cameron Highlands",
    "tag": "Pahang · Highland escape",
    "image": "https://commons.wikimedia.org/wiki/Special:FilePath/Cameron%20Highlands%20%28Tea%20Plantation%29.jpg?width=1500",
    "credit": "DerYang2004",
    "license": "CC BY-SA 4.0",
    "source": "https://commons.wikimedia.org/wiki/File:Cameron_Highlands_%28Tea_Plantation%29.jpg"
  }
];
const STAYHUB_INTERIORS = [
  "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1600&q=85",
  "https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=1200&q=85",
  "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1200&q=85",
  "https://images.unsplash.com/photo-1564501049412-61c2a3083791?auto=format&fit=crop&w=1200&q=85",
  "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=1200&q=85",
  "https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=1200&q=85",
  "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=1200&q=85",
  "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1200&q=85"
];
