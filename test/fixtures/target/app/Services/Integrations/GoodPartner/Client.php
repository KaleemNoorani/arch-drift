<?php

namespace App\Services\Integrations\GoodPartner;

class Client
{
    public function fetchStatus(string $orderId)
    {
        try {
            return $this->http()->get("/orders/{$orderId}")->json();
        } catch (\Throwable $e) {
            report($e);
            return null;
        }
    }
}
