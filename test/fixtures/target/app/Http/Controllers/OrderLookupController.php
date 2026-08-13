<?php

namespace App\Http\Controllers;

use App\Models\FulfillmentOrder;

class OrderLookupController
{
    public function show(string $orderNumber)
    {
        // Bug: order_number is a display value, not a lookup key.
        $order = FulfillmentOrder::where('order_number', $orderNumber)->firstOrFail();

        return view('orders.show', ['order' => $order]);
    }

    public function label(FulfillmentOrder $order)
    {
        // Fine: purely for display, nowhere near a lookup.
        return "Order #{$order->order_number}";
    }
}
