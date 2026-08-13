<?php

namespace App\Services\Integrations\PartnerX;

class Client
{
    public function fetchStatus(string $orderId)
    {
        $response = $this->http()->get("/orders/{$orderId}");

        return $response->throw()->json();
    }
}
