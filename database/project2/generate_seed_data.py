#!/usr/bin/env python3
"""
Phase 2 database seeding — data generator.

Generates CSV files for the POS database:
    - employees.csv
    - menu_items.csv
    - inventory_items.csv
    - customer_orders.csv
    - order_items.csv
    - recipes.csv
    - reorder_requests.csv

The CSVs are then bulk-loaded into the database with seed.sql (COPY).

------------------------------------------------------------------------------
ASSUMED SCHEMA (adjust column names/types to match your final DDL)
------------------------------------------------------------------------------
employees(
    employee_id INTEGER PRIMARY KEY,
    name        TEXT,
    role        TEXT
)

menu_items(
    menu_item_id   INTEGER      PRIMARY KEY,
    name           TEXT,
    category       TEXT,
    price          NUMERIC(6,2)
)

inventory_items(
    inventory_item_id INTEGER      PRIMARY KEY,
    name              TEXT,
    quantity          NUMERIC(10,2),
    unit              TEXT,
    reorder_level     NUMERIC(10,2)
)

customer_orders(
    order_id        INTEGER      PRIMARY KEY,
    employee_id     INTEGER,     -- FK -> employees(employee_id); assumed seeded 1..N_EMPLOYEES
    order_timestamp TIMESTAMP,
    total_price     NUMERIC(8,2) -- convenience column; equals SUM(order_items line totals)
)

order_items(
    order_item_id INTEGER PRIMARY KEY,
    order_id      INTEGER,   -- FK -> customer_orders(order_id)
    menu_item_id  INTEGER,   -- FK -> menu_items(menu_item_id)
    quantity      INTEGER
)

recipes(
    recipe_id        INTEGER PRIMARY KEY,
    menu_item_id     INTEGER,       -- FK -> menu_items(menu_item_id)
    inventory_item_id INTEGER,      -- FK -> inventory_items(inventory_item_id)
    quantity_required NUMERIC(10,4)
)

reorder_requests(
    reorder_request_id INTEGER PRIMARY KEY,
    inventory_item_id  INTEGER,       -- FK -> inventory_items(inventory_item_id)
    quantity_requested NUMERIC(10,2),
    request_date_time  TIMESTAMP
)
------------------------------------------------------------------------------

Team-of-5 workload minimums this script is built to clear:
    alpha  >= 52 weeks of history
    beta   >= ~$1.00M total sales
    phi    >= 3 peak days
    delta  >= 20 menu items
"""

import csv
import random
from datetime import date, datetime, timedelta

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------
RANDOM_SEED   = 331          # deterministic output so the whole team gets identical data
EMPLOYEE_IDS  = [1, 2, 3, 4, 5]
N_EMPLOYEES   = len(EMPLOYEE_IDS)  # number of seeded employees
WEEKS         = 52           # alpha: length of history
END_DATE      = date(2026, 8, 31)         # last day of sales history
START_DATE    = END_DATE - timedelta(weeks=WEEKS) + timedelta(days=1)

# Open hours: orders are spread across the service window each day
OPEN_HOUR     = 11
CLOSE_HOUR    = 22

# Average orders on a normal weekday; weekends and peak days scale this up.
BASE_ORDERS_PER_DAY = 230
WEEKEND_MULTIPLIER  = 1.35
PEAK_MULTIPLIER     = 3.0

random.seed(RANDOM_SEED)

# --------------------------------------------------------------------------
# 1. Employees
# --------------------------------------------------------------------------
# (employee_id, name, role)
employees_rows = [
    (1, "Luke Doudna", "Cashier"),
    (2, "Connor Church", "Cashier"),
    (3, "Armaan Khatwani", "Cashier"),
    (4, "Rohan Doshi", "Manager"),
    (5, "Phillip Ronin", "Manager"),
]

# --------------------------------------------------------------------------
# 2. Menu items  (delta: need at least 20)
# --------------------------------------------------------------------------
# (name, category, price).  Popularity weight is assigned further below.
MENU = [
    # Milk teas
    ("Classic Milk Tea",        "Milk Tea",   5.25),
    ("Taro Milk Tea",           "Milk Tea",   5.75),
    ("Thai Milk Tea",           "Milk Tea",   5.75),
    ("Matcha Milk Tea",         "Milk Tea",   5.95),
    ("Brown Sugar Milk Tea",    "Milk Tea",   6.25),
    ("Honeydew Milk Tea",       "Milk Tea",   5.75),
    ("Wintermelon Milk Tea",    "Milk Tea",   5.50),
    ("Coffee Milk Tea",         "Milk Tea",   5.75),
    # Fruit teas
    ("Passion Fruit Green Tea", "Fruit Tea",  5.25),
    ("Mango Green Tea",         "Fruit Tea",  5.25),
    ("Strawberry Tea",          "Fruit Tea",  5.50),
    ("Peach Tea",               "Fruit Tea",  5.25),
    ("Lychee Tea",              "Fruit Tea",  5.50),
    ("Grapefruit Green Tea",    "Fruit Tea",  5.50),
    # Smoothies
    ("Mango Smoothie",          "Smoothie",   6.50),
    ("Taro Smoothie",           "Smoothie",   6.50),
    ("Strawberry Smoothie",     "Smoothie",   6.50),
    ("Matcha Smoothie",         "Smoothie",   6.75),
    ("Oreo Smoothie",           "Smoothie",   6.75),
    # Toppings (sold as add-on line items)
    ("Tapioca Pearls",          "Topping",    0.75),
    ("Pudding",                 "Topping",    0.75),
    ("Grass Jelly",             "Topping",    0.75),
    ("Aloe Vera",               "Topping",    0.75),
    ("Popping Boba",            "Topping",    0.75),
]

# Drinks vs toppings split (toppings are chosen as extras, not standalone orders)
drink_ids   = [i + 1 for i, m in enumerate(MENU) if m[1] != "Topping"]
topping_ids = [i + 1 for i, m in enumerate(MENU) if m[1] == "Topping"]

# Popularity weights so sales aren't perfectly uniform (helps trend analysis).
drink_weights = [random.randint(3, 12) for _ in drink_ids]
price_by_id   = {i + 1: MENU[i][2] for i in range(len(MENU))}

# --------------------------------------------------------------------------
# 3. Inventory Items (ingredients, toppings, and single-use supplies)
# --------------------------------------------------------------------------
# (inventory_item_id, name, quantity, unit, reorder_level)
INVENTORY = [
    (1,  "Black Tea Leaves",            150.00, "lbs",     30.00),
    (2,  "Green Tea Leaves",            120.00, "lbs",     25.00),
    (3,  "Oolong Tea Leaves",           100.00, "lbs",     20.00),
    (4,  "Thai Tea Mix",                80.00,  "lbs",     15.00),
    (5,  "Non-Dairy Creamer Powder",    500.00, "lbs",     100.00),
    (6,  "Whole Milk",                  120.00, "gallons", 25.00),
    (7,  "Condensed Milk",              60.00,  "cans",    15.00),
    (8,  "Taro Powder",                 90.00,  "lbs",     20.00),
    (9,  "Matcha Powder",               50.00,  "lbs",     10.00),
    (10, "Brown Sugar Syrup",           40.00,  "gallons", 8.00),
    (11, "Honeydew Syrup",              30.00,  "gallons", 6.00),
    (12, "Wintermelon Syrup",           30.00,  "gallons", 6.00),
    (13, "Coffee Concentrate",          25.00,  "gallons", 5.00),
    (14, "Passion Fruit Syrup",         35.00,  "gallons", 7.00),
    (15, "Mango Jam/Syrup",             45.00,  "gallons", 10.00),
    (16, "Strawberry Puree",            45.00,  "gallons", 10.00),
    (17, "Peach Syrup",                 30.00,  "gallons", 6.00),
    (18, "Lychee Syrup",                30.00,  "gallons", 6.00),
    (19, "Grapefruit Syrup",            25.00,  "gallons", 5.00),
    (20, "Oreo Crumbs",                 40.00,  "lbs",     8.00),
    (21, "Simple Syrup (Fructose)",     150.00, "gallons", 30.00),
    (22, "Raw Tapioca Pearls (Boba)",   350.00, "lbs",     70.00),
    (23, "Egg Pudding Mix",             60.00,  "lbs",     12.00),
    (24, "Grass Jelly Cans",            80.00,  "cans",    15.00),
    (25, "Aloe Vera Tub",               50.00,  "tubs",    10.00),
    (26, "Popping Boba (Mango/Passion)", 60.00, "tubs",    12.00),
    (27, "16oz Plastic Cups",           15000.00,"units",  3000.00),
    (28, "24oz Plastic Cups",           20000.00,"units",  4000.00),
    (29, "Plastic Lids",                35000.00,"units",  5000.00),
    (30, "Boba Straws",                 40000.00,"units",  8000.00),
    (31, "Napkins",                     50000.00,"units",  10000.00),
    (32, "To-Go Paper Bags",            8000.00, "units",  1500.00),
    (33, "Ice",                         800.00,  "lbs",    150.00)
]

# --------------------------------------------------------------------------
# 4. Recipes
# --------------------------------------------------------------------------
# Each tuple is:
#     (inventory_item_id, quantity_required)
#
# The quantity uses the same unit as the corresponding Inventory Item.
# For example:
#     tea leaves -> lbs
#     syrup      -> gallons
#     cups/lids  -> units
#
# Each menu item can therefore have several recipe rows.

RECIPE_MAP = {
    # 1 - Classic Milk Tea
    1: [
        (1,  0.025),   # Black Tea Leaves
        (5,  0.040),   # Non-Dairy Creamer Powder
        (21, 0.015),   # Simple Syrup
        (27, 1.000),   # 16oz Cup
        (29, 1.000),   # Lid
        (30, 1.000),   # Boba Straw
        (33, 0.300),   # Ice
    ],

    # 2 - Taro Milk Tea
    2: [
        (1,  0.020),
        (5,  0.035),
        (8,  0.030),   # Taro Powder
        (21, 0.015),
        (27, 1.000),
        (29, 1.000),
        (30, 1.000),
        (33, 0.300),
    ],

    # 3 - Thai Milk Tea
    3: [
        (4,  0.035),   # Thai Tea Mix
        (5,  0.030),
        (7,  0.080),   # Condensed Milk
        (21, 0.010),
        (27, 1.000),
        (29, 1.000),
        (30, 1.000),
        (33, 0.300),
    ],

    # 4 - Matcha Milk Tea
    4: [
        (9,  0.020),   # Matcha Powder
        (6,  0.060),   # Whole Milk
        (21, 0.015),
        (27, 1.000),
        (29, 1.000),
        (30, 1.000),
        (33, 0.300),
    ],

    # 5 - Brown Sugar Milk Tea
    5: [
        (6,  0.070),
        (10, 0.020),   # Brown Sugar Syrup
        (22, 0.030),   # Tapioca
        (27, 1.000),
        (29, 1.000),
        (30, 1.000),
        (33, 0.300),
    ],

    # 6 - Honeydew Milk Tea
    6: [
        (1,  0.020),
        (5,  0.035),
        (11, 0.020),   # Honeydew Syrup
        (27, 1.000),
        (29, 1.000),
        (30, 1.000),
        (33, 0.300),
    ],

    # 7 - Wintermelon Milk Tea
    7: [
        (1,  0.020),
        (5,  0.035),
        (12, 0.020),   # Wintermelon Syrup
        (27, 1.000),
        (29, 1.000),
        (30, 1.000),
        (33, 0.300),
    ],

    # 8 - Coffee Milk Tea
    8: [
        (1,  0.015),
        (5,  0.035),
        (13, 0.025),   # Coffee Concentrate
        (21, 0.010),
        (27, 1.000),
        (29, 1.000),
        (30, 1.000),
        (33, 0.300),
    ],

    # 9 - Passion Fruit Green Tea
    9: [
        (2,  0.025),   # Green Tea Leaves
        (14, 0.020),   # Passion Fruit Syrup
        (21, 0.010),
        (27, 1.000),
        (29, 1.000),
        (30, 1.000),
        (33, 0.300),
    ],

    # 10 - Mango Green Tea
    10: [
        (2,  0.025),
        (15, 0.020),   # Mango Jam/Syrup
        (21, 0.010),
        (27, 1.000),
        (29, 1.000),
        (30, 1.000),
        (33, 0.300),
    ],

    # 11 - Strawberry Tea
    11: [
        (2,  0.025),
        (16, 0.020),   # Strawberry Puree
        (21, 0.010),
        (27, 1.000),
        (29, 1.000),
        (30, 1.000),
        (33, 0.300),
    ],

    # 12 - Peach Tea
    12: [
        (2,  0.025),
        (17, 0.020),   # Peach Syrup
        (21, 0.010),
        (27, 1.000),
        (29, 1.000),
        (30, 1.000),
        (33, 0.300),
    ],

    # 13 - Lychee Tea
    13: [
        (2,  0.025),
        (18, 0.020),   # Lychee Syrup
        (21, 0.010),
        (27, 1.000),
        (29, 1.000),
        (30, 1.000),
        (33, 0.300),
    ],

    # 14 - Grapefruit Green Tea
    14: [
        (2,  0.025),
        (19, 0.020),   # Grapefruit Syrup
        (21, 0.010),
        (27, 1.000),
        (29, 1.000),
        (30, 1.000),
        (33, 0.300),
    ],

    # 15 - Mango Smoothie
    15: [
        (6,  0.050),
        (15, 0.030),
        (21, 0.010),
        (28, 1.000),   # 24oz Cup
        (29, 1.000),
        (30, 1.000),
        (33, 0.450),
    ],

    # 16 - Taro Smoothie
    16: [
        (6,  0.050),
        (8,  0.040),
        (21, 0.010),
        (28, 1.000),
        (29, 1.000),
        (30, 1.000),
        (33, 0.450),
    ],

    # 17 - Strawberry Smoothie
    17: [
        (6,  0.050),
        (16, 0.030),
        (21, 0.010),
        (28, 1.000),
        (29, 1.000),
        (30, 1.000),
        (33, 0.450),
    ],

    # 18 - Matcha Smoothie
    18: [
        (6,  0.050),
        (9,  0.030),
        (21, 0.010),
        (28, 1.000),
        (29, 1.000),
        (30, 1.000),
        (33, 0.450),
    ],

    # 19 - Oreo Smoothie
    19: [
        (6,  0.050),
        (20, 0.040),   # Oreo Crumbs
        (21, 0.010),
        (28, 1.000),
        (29, 1.000),
        (30, 1.000),
        (33, 0.450),
    ],

    # Toppings sold as add-on Menu Items
    20: [(22, 0.030)],  # Tapioca Pearls
    21: [(23, 0.030)],  # Pudding
    22: [(24, 0.050)],  # Grass Jelly
    23: [(25, 0.020)],  # Aloe Vera
    24: [(26, 0.020)],  # Popping Boba
}

recipe_rows = []
recipe_id = 0

for menu_item_id, ingredients in RECIPE_MAP.items():
    for inventory_item_id, quantity_required in ingredients:
        recipe_id += 1
        recipe_rows.append((
            recipe_id,
            menu_item_id,
            inventory_item_id,
            f"{quantity_required:.4f}"
        ))

# --------------------------------------------------------------------------
# 5. Peak days  (phi: at least 3)
# --------------------------------------------------------------------------
# Deliberately chosen high-volume days (e.g. grand opening, promo, holiday).
PEAK_DAYS = {
    date(2025, 11, 28),   # Black Friday promo
    date(2026, 5, 9),     # spring festival / grand-reopening
    date(2026, 8, 16),    # back-to-school bogo
}

# --------------------------------------------------------------------------
# 6. Generate orders + order items
# --------------------------------------------------------------------------
menu_rows   = [(i + 1, MENU[i][0], MENU[i][1], f"{MENU[i][2]:.2f}") for i in range(len(MENU))]
inventory_rows = [(item[0], item[1], f"{item[2]:.2f}", item[3], f"{item[4]:.2f}") for item in INVENTORY]
order_rows  = []
item_rows   = []

order_id      = 0
order_item_id = 0
total_sales   = 0.0

day = START_DATE
while day <= END_DATE:
    # how many orders today
    n = BASE_ORDERS_PER_DAY
    if day.weekday() >= 5:                 # Sat/Sun
        n = int(n * WEEKEND_MULTIPLIER)
    if day in PEAK_DAYS:
        n = int(n * PEAK_MULTIPLIER)
    n = max(1, int(random.gauss(n, n * 0.10)))   # +/- ~10% daily noise

    for _ in range(n):
        order_id += 1
        employee_id = random.choice(EMPLOYEE_IDS)
        hour   = random.randint(OPEN_HOUR, CLOSE_HOUR - 1)
        minute = random.randint(0, 59)
        second = random.randint(0, 59)
        ts = datetime(day.year, day.month, day.day, hour, minute, second)

        # 1-3 drinks per order
        n_drinks = random.choices([1, 2, 3], weights=[55, 33, 12])[0]
        order_total = 0.0
        for _ in range(n_drinks):
            mid = random.choices(drink_ids, weights=drink_weights)[0]
            qty = random.choices([1, 2], weights=[85, 15])[0]
            order_item_id += 1
            item_rows.append((order_item_id, order_id, mid, qty))
            order_total += price_by_id[mid] * qty
            # ~45% of drinks add one topping
            if random.random() < 0.45:
                tid = random.choice(topping_ids)
                order_item_id += 1
                item_rows.append((order_item_id, order_id, tid, qty))
                order_total += price_by_id[tid] * qty

        order_rows.append((order_id, employee_id, ts.strftime("%Y-%m-%d %H:%M:%S"), f"{order_total:.2f}"))
        total_sales += order_total

    day += timedelta(days=1)

# --------------------------------------------------------------------------
# 7. Generate reorder requests
# --------------------------------------------------------------------------

# Starting stock level for each inventory item.
# Reorders will replenish an item back to this amount.
starting_inventory = {
    item[0]: item[2]
    for item in INVENTORY
}

current_inventory = starting_inventory.copy()

# Reorder level for each inventory item.
reorder_levels = {
    item[0]: item[4]
    for item in INVENTORY
}

# Map order_id to a date so each order item can be associated with a day.
order_dates = {
    row[0]: datetime.strptime(row[2], "%Y-%m-%d %H:%M:%S").date()
    for row in order_rows
}

daily_usage = {}

for order_item_id, order_id, menu_item_id, quantity in item_rows:
    order_day = order_dates[order_id]

    if order_day not in daily_usage:
        daily_usage[order_day] = {}

    # Look up the recipe for this menu item.
    for inventory_item_id, quantity_required in RECIPE_MAP.get(menu_item_id, []):
        amount_used = quantity_required * quantity

        daily_usage[order_day][inventory_item_id] = (
            daily_usage[order_day].get(inventory_item_id, 0)
            + amount_used
        )


reorder_rows = []
reorder_request_id = 0

# Process the days
for order_day in sorted(daily_usage.keys()):

    # Remove that day's consumed inventory.
    for inventory_item_id, amount_used in daily_usage[order_day].items():
        current_inventory[inventory_item_id] -= amount_used

    # Nightly inventory check.
    for inventory_item_id in current_inventory:

        if current_inventory[inventory_item_id] <= reorder_levels[inventory_item_id]:

            # Refill back to the normal starting inventory level.
            quantity_requested = (
                starting_inventory[inventory_item_id]
                - current_inventory[inventory_item_id]
            )

            reorder_request_id += 1

            # Nightly reorder request after closing.
            request_time = datetime(
                order_day.year,
                order_day.month,
                order_day.day,
                22,
                30,
                0
            )

            reorder_rows.append((
                reorder_request_id,
                inventory_item_id,
                f"{quantity_requested:.2f}",
                request_time.strftime("%Y-%m-%d %H:%M:%S")
            ))

            # Assume the reorder arrives/restocks inventory.
            current_inventory[inventory_item_id] += quantity_requested

# --------------------------------------------------------------------------
# 8. Write CSVs (header row included; matches COPY ... CSV HEADER)
# --------------------------------------------------------------------------
def write_csv(path, header, rows):
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)

write_csv("employees.csv",       ["employee_id", "name", "role"], employees_rows)
write_csv("menu_items.csv",      ["menu_item_id", "name", "category", "price"], menu_rows)
write_csv("inventory_items.csv", ["inventory_item_id", "name", "quantity", "unit", "reorder_level"], inventory_rows)
write_csv("customer_orders.csv", ["order_id", "employee_id", "order_timestamp", "total_price"], order_rows)
write_csv("order_items.csv",     ["order_item_id", "order_id", "menu_item_id", "quantity"], item_rows)
write_csv("recipes.csv", ["recipe_id", "menu_item_id", "inventory_item_id", "quantity_required"], recipe_rows)
write_csv("reorder_requests.csv", ["reorder_request_id", "inventory_item_id", "quantity_requested", "request_date_time"], reorder_rows)

# --------------------------------------------------------------------------
# 9. Report — confirms the workload minimums are met
# --------------------------------------------------------------------------
print("Seed data generated")
print(f"  history span      : {START_DATE} -> {END_DATE}  ({WEEKS} weeks)")
print(f"  employees         : {len(employees_rows)} rows")
print(f"  menu items        : {len(menu_rows)}  (delta min 20)")
print(f"   inventory items   : {len(inventory_rows)} rows")
print(f"  peak days         : {len(PEAK_DAYS)}  (phi min 3)")
print(f"  customer_orders   : {len(order_rows):,} rows")
print(f"  order_items       : {len(item_rows):,} rows")
print(f"  recipes           : {len(recipe_rows)} rows")
print(f"  reorder requests  : {len(reorder_rows)} rows")
print(f"  total sales (beta): ${total_sales:,.2f}  (min ~$1.00M)")
